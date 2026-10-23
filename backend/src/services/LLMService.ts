import { GoogleGenerativeAI } from '@google/generative-ai';
import { Citation, RankedChunk } from '../types';
import { graphStore } from '../store/GraphStore';
import { keyManager, KeyManager } from './KeyManager';

export class LLMService {
  private keyManager: KeyManager;
  private clientFactory?: (apiKey: string) => any;

  constructor(km: KeyManager = keyManager, clientFactory?: (apiKey: string) => any) {
    this.keyManager = km;
    this.clientFactory = clientFactory;
  }

  public setKeyManager(km: KeyManager): void {
    this.keyManager = km;
  }

  public setClientFactory(factory: (apiKey: string) => any): void {
    this.clientFactory = factory;
  }

  /**
   * Generates an answer to the question grounded in the retrieved chunks and knowledge graph.
   * Extracts and returns structured citations mapped to chunk metadata.
   */
  public async generateAnswer(
    question: string,
    chunks: RankedChunk[]
  ): Promise<{ answer: string; citations: Citation[] }> {
    if (!chunks || chunks.length === 0) {
      return {
        answer: "I don't have information about that in the uploaded documents.",
        citations: [],
      };
    }

    const modelName = process.env.LLM_MODEL || 'gemini-3.8-flash';

    // 1. Format context chunks with 1-based indexing [1], [2], ...
    const contextFormatted = chunks
      .map((c, i) => {
        const idx = i + 1;
        const metaParts = [`doc: ${c.metadata.filename}`];
        if (c.metadata.page !== undefined) metaParts.push(`page: ${c.metadata.page}`);
        if (c.metadata.sheet) metaParts.push(`sheet: ${c.metadata.sheet}`);
        if (c.metadata.rowStart) metaParts.push(`row: ${c.metadata.rowStart}`);
        if (c.metadata.lineStart) metaParts.push(`line: ${c.metadata.lineStart}`);
        if (c.metadata.isOCR) metaParts.push(`isOCR: true`);

        return `[${idx}] (${metaParts.join(', ')})\n"${c.text}"`;
      })
      .join('\n\n');

    // 2. Query GraphStore for 1-hop subgraph matching relevant entities in chunks/question
    let graphContextFormatted = '';
    try {
      const allGraph = graphStore.getAll();
      const combinedText = `${question} ${chunks.map((c) => c.text).join(' ')}`.toLowerCase();
      const matchedEntityIds: string[] = [];

      for (const node of allGraph.nodes) {
        if (node.status === 'merged') continue;
        const nodeNameLower = node.name.toLowerCase();
        if (combinedText.includes(nodeNameLower)) {
          matchedEntityIds.push(node.id);
        } else if (node.aliases?.some((a) => combinedText.includes(a.toLowerCase()))) {
          matchedEntityIds.push(node.id);
        }
      }

      if (matchedEntityIds.length > 0) {
        const subgraph = graphStore.getSubgraph(matchedEntityIds, 1);
        const nodeMap = new Map(subgraph.nodes.map((n) => [n.id, n.name]));

        const formattedEdges = subgraph.edges
          .filter((e) => e.curationStatus !== 'rejected')
          .slice(0, 10)
          .map((e) => {
            const src = nodeMap.get(e.sourceId) || e.sourceId;
            const tgt = nodeMap.get(e.targetId) || e.targetId;
            return `- [🔗 ${src} -> ${e.relationType} -> ${tgt}]: ${e.description}`;
          });

        if (formattedEdges.length > 0) {
          graphContextFormatted = `\n\nVERIFIED KNOWLEDGE GRAPH RELATIONSHIPS:\n${formattedEdges.join('\n')}`;
        }
      }
    } catch (graphErr) {
      console.warn('Failed to inject graph context:', graphErr);
    }

    const systemInstruction = `You are a helpful, intelligent, and precise academic tutor. Answer the user's question accurately using ONLY the provided context chunks and verified knowledge graph relationships.

MULTILINGUAL CAPABILITIES:
1. You support ALL human languages (English, Spanish, French, German, Chinese, Japanese, Hindi, Bengali, Arabic, Russian, Portuguese, etc.).
2. ALWAYS respond in the SAME language that the user asks their question in.
3. If the user asks in Hindi, answer in Hindi; if in Spanish, answer in Spanish; if in English, answer in English.
4. Translate, explain, and synthesize concepts from the context into the user's preferred language accurately.
5. If the user simply sends a greeting (e.g. "hi", "hello", "hola", "namaste", "bonjour"), reply warmly in that language, introduce yourself as their AI study tutor, and invite them to ask questions about their study materials.

MATHEMATICAL, VECTOR, & SCIENTIFIC NOTATION:
1. Format all mathematical expressions, equations, vectors, operators, matrices, and scientific symbols in standard clean LaTeX:
   - Inline math: Enclose within single dollar signs like $x^2 + y^2 = r^2$, $\\vec{v}$, $\\vec{F} = m\\vec{a}$, or $\\nabla T$.
   - Display / Block equations: Enclose within double dollar signs on their own line like:
     $$\\nabla \\cdot \\vec{E} = \\frac{\\rho}{\\varepsilon_0}$$
   - Vectors: Always use LaTeX vector notation like $\\vec{v}$, $\\mathbf{v}$, $\\vec{a}$, or unit vectors $\\hat{i}, \\hat{j}, \\hat{k}$.
   - Matrices: Use LaTeX matrices like:
     $$\\vec{v} = \\begin{pmatrix} v_x \\\\ v_y \\\\ v_z \\end{pmatrix}$$ or $$\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}$$
   - Operators & Calculus: Use standard LaTeX symbols: $\\nabla$ (gradient/del), $\\partial$ (partial), $\\int$ (integral), $\\oint$, $\\sum$ (sum), $\\prod$ (product), $\\lim$ (limit), $\\infty$ (infinity).
   - Greek letters: Use LaTeX like $\\alpha, \\beta, \\gamma, \\theta, \\lambda, \\mu, \\sigma, \\omega, \\Delta, \\Sigma, \\Omega$.
   - Relations: Use $\\approx$, $\\leq$, $\\geq$, $\\neq$, $\\pm$, $\\times$, $\\cdot$, $\\in$, $\\notin$.

CITATION & KNOWLEDGE GRAPH INSTRUCTIONS:
1. For every factual statement derived from the documents, append citation tags like [1], [2] referencing the chunk number supporting that statement.
2. If multiple chunks support a statement, append all relevant tags (e.g. [1][2]).
3. Whenever referencing relationships between academic concepts that are present in the VERIFIED KNOWLEDGE GRAPH RELATIONSHIPS, format the relationship as:
   [🔗 Source -> RELATION -> Target]
   (e.g., [🔗 Linear Regression -> USES -> Gradient Descent]).
4. If the answer is not present in the provided context and the user asks a specific factual question about the documents, say: "I don't have information about that in the uploaded documents."
5. Never invent facts or extrapolate beyond what is stated in the context.`;

    const userPrompt = `CONTEXT:
${contextFormatted}${graphContextFormatted}

USER QUESTION: ${question}

ANSWER:`;

    let rawAnswer = '';

    if (this.keyManager.getTotalKeyCount() === 0) {
      const single = process.env.GEMINI_API_KEY;
      const multi = process.env.GEMINI_API_KEYS;
      if (
        (single && single.trim() && single.trim() !== 'your_key_here') ||
        (multi && multi.trim())
      ) {
        this.keyManager.reset();
      }
    }

    const isMock =
      (process.env.NODE_ENV === 'test' && !this.clientFactory) ||
      this.keyManager.getTotalKeyCount() === 0;

    if (isMock) {
      rawAnswer = this.mockAnswer(question, chunks);
    } else {
      rawAnswer = await this.keyManager.executeWithFailover(async (apiKey) => {
        const genAI = this.clientFactory ? this.clientFactory(apiKey) : new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: systemInstruction,
        });

        const result = await model.generateContent(userPrompt);
        return result.response.text();
      });
    }

    const citations = this.extractCitations(rawAnswer, chunks);
    return {
      answer: rawAnswer.trim(),
      citations,
    };
  }

  private mockAnswer(question: string, chunks: RankedChunk[]): string {
    const qTrimmed = question.trim();
    const qLower = qTrimmed.toLowerCase();

    // Check for conversational greetings across languages
    const greetings = [
      'hi', 'hello', 'hey', 'greetings', 'good morning', 'good afternoon', 'good evening',
      'hola', 'buenos dias', 'buenas tardes',
      'bonjour', 'salut',
      'namaste', 'namaskar', 'kaise ho',
      'ciao', 'hallo', 'guten tag',
      'ni hao', 'nǐ hǎo', 'konnichiwa',
      'olá', 'ola',
    ];

    if (greetings.some((g) => qLower === g || qLower.startsWith(g + ' ') || qLower.startsWith(g + '!'))) {
      if (['hola', 'buenos dias', 'buenas tardes'].some((g) => qLower.includes(g))) {
        return "¡Hola! Soy tu asistente de estudio Smart Teacher. Estoy listo para ayudarte a explorar tus materiales de estudio, resolver ecuaciones, vectores o responder cualquier duda en tu idioma. ¿Qué te gustaría repasar hoy?";
      }
      if (['bonjour', 'salut'].some((g) => qLower.includes(g))) {
        return "Bonjour ! Je suis votre tuteur d'étude IA Smart Teacher. Je suis prêt à vous aider à explorer vos documents, résoudre des équations, analyser des vecteurs ou répondre à vos questions. De quoi aimeriez-vous discuter aujourd'hui ?";
      }
      if (['namaste', 'namaskar', 'kaise ho'].some((g) => qLower.includes(g))) {
        return "नमस्ते! मैं आपका स्मार्ट टीचर एआई स्टडी असिस्टेंट हूँ। मैं आपके अपलोड किए गए अध्ययन सामग्री, गणितीय समीकरणों, वैक्टर और सवालों को समझने में आपकी मदद के लिए तैयार हूँ। आज आप क्या पढ़ना चाहते हैं?";
      }
      return "Hello! I am your Smart Teacher AI study assistant. I am ready to help you explore your uploaded study materials, solve mathematical equations, analyze vectors and formulas, or answer questions in any language. What would you like to learn today?";
    }

    const qTerms = qLower.split(/\W+/).filter((w) => w.length > 2);

    // Find first chunk that has matching terms
    let bestChunkIndex = -1;
    let maxMatch = 0;

    for (let i = 0; i < chunks.length; i++) {
      const cLower = chunks[i].text.toLowerCase();
      let matchCount = 0;
      for (const term of qTerms) {
        if (cLower.includes(term)) matchCount++;
      }
      if (matchCount > maxMatch) {
        maxMatch = matchCount;
        bestChunkIndex = i;
      }
    }

    if (bestChunkIndex === -1 && chunks[0]?.score < 0.1) {
      return "I don't have information about that in the uploaded documents.";
    }

    const targetIdx = bestChunkIndex >= 0 ? bestChunkIndex : 0;
    const targetChunk = chunks[targetIdx];

    // Clean excerpt
    let excerpt = targetChunk.text
      .replace(/!\[([^\]]*)\]\(data:image\/[a-zA-Z0-9.\-_+]+;base64,[A-Za-z0-9+/=\s]+\)/gi, (_m, alt) => {
        const cleanAlt = alt?.replace(/\\-/g, '-').trim();
        return cleanAlt ? ` $${cleanAlt}$ ` : ' [Formula] ';
      })
      .replace(/data:image\/[a-zA-Z0-9.\-_+]+;base64,[A-Za-z0-9+/=\s]{20,}/gi, ' [Formula] ')
      .replace(/!\[\s*\]\(\s*\)/g, '')
      .replace(/\\\(i\\\)/gi, '(i)')
      .replace(/\s+/g, ' ')
      .trim();

    excerpt = excerpt.slice(0, 220).trim();

    return `Based on the provided documents: ${excerpt} [${targetIdx + 1}].`;
  }

  private extractCitations(answer: string, chunks: RankedChunk[]): Citation[] {
    const citations: Citation[] = [];
    const seenIndices = new Set<number>();

    const matches = answer.matchAll(/\[(\d+)\]/g);
    for (const match of matches) {
      const index = parseInt(match[1], 10);
      if (seenIndices.has(index)) continue;

      if (index >= 1 && index <= chunks.length) {
        seenIndices.add(index);
        const chunk = chunks[index - 1];

        // Extract a clean quote (first ~180 characters or relevant sentence)
        const quote = chunk.text
          .replace(/\s+/g, ' ')
          .slice(0, 200)
          .trim();

        citations.push({
          index,
          chunkId: chunk.chunkId,
          quote,
          metadata: chunk.metadata,
        });
      }
    }

    return citations.sort((a, b) => a.index - b.index);
  }
}

export const llmService = new LLMService();
