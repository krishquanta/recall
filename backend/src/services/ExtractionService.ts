import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Page } from '../types';

export class ExtractionService {
  private genAI: GoogleGenerativeAI | null = null;

  constructor() {
    if (process.env.NODE_ENV !== 'test') {
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey && apiKey.trim() && apiKey !== 'your_key_here') {
        this.genAI = new GoogleGenerativeAI(apiKey.trim());
      }
    }
  }

  private getGenAI(): GoogleGenerativeAI | null {
    if (process.env.NODE_ENV === 'test') {
      return null;
    }
    if (!this.genAI) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey && apiKey.trim() && apiKey !== 'your_key_here') {
        this.genAI = new GoogleGenerativeAI(apiKey.trim());
      }
    }
    return this.genAI;
  }

  public async extract(filePath: string, mimeType: string, filename?: string): Promise<Page[]> {
    const name = filename || path.basename(filePath);
    const ext = path.extname(name).toLowerCase();

    // 1. PDF
    if (mimeType === 'application/pdf' || ext === '.pdf') {
      return this.extractPDF(filePath);
    }

    // 2. Microsoft Word (.docx)
    if (
      ext === '.docx' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      return this.extractDocx(filePath);
    }

    // 3. Microsoft PowerPoint (.pptx)
    if (
      ext === '.pptx' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ) {
      return this.extractPptx(filePath);
    }

    // 4. OpenDocument Text (.odt)
    if (ext === '.odt' || mimeType === 'application/vnd.oasis.opendocument.text') {
      return this.extractOdt(filePath);
    }

    // 5. Rich Text Format (.rtf)
    if (ext === '.rtf' || mimeType === 'application/rtf' || mimeType === 'text/rtf') {
      return this.extractRTF(filePath);
    }

    // 6. HTML (.html, .htm)
    if (ext === '.html' || ext === '.htm' || mimeType === 'text/html') {
      return this.extractHTML(filePath);
    }

    // 7. JSON / Data (.json, .jsonl)
    if (ext === '.json' || ext === '.jsonl' || mimeType === 'application/json') {
      return this.extractJSON(filePath);
    }

    // 8. XML (.xml)
    if (ext === '.xml' || mimeType === 'text/xml' || mimeType === 'application/xml') {
      return this.extractXML(filePath);
    }

    // 9. Legacy Office (.doc, .ppt, .odp)
    if (ext === '.doc' || ext === '.ppt' || ext === '.odp' || mimeType.includes('msword') || mimeType.includes('powerpoint')) {
      return this.extractLegacyOffice(filePath, ext);
    }

    // 10. Spreadsheets (Excel, CSV, TSV, ODS)
    if (
      mimeType.includes('spreadsheet') ||
      mimeType.includes('excel') ||
      mimeType === 'text/csv' ||
      mimeType === 'text/tab-separated-values' ||
      ['.xlsx', '.xls', '.csv', '.tsv', '.ods'].includes(ext)
    ) {
      return this.extractXLSX(filePath);
    }

    // 11. Markdown
    if (
      mimeType === 'text/markdown' ||
      mimeType === 'text/x-markdown' ||
      ext === '.md' ||
      ext === '.markdown'
    ) {
      return this.extractMarkdown(filePath);
    }

    // 12. Images and Handwritten Notes (PNG, JPG, WEBP, HEIC)
    if (
      mimeType.startsWith('image/') ||
      ['.png', '.jpg', '.jpeg', '.webp', '.heic'].includes(ext)
    ) {
      const effectiveMime = mimeType.startsWith('image/') ? mimeType : this.guessImageMime(ext);
      return this.extractImage(filePath, effectiveMime);
    }

    // 13. Default to plain text
    return this.extractText(filePath);
  }

  private guessImageMime(ext: string): string {
    switch (ext) {
      case '.png':
        return 'image/png';
      case '.webp':
        return 'image/webp';
      case '.heic':
        return 'image/heic';
      default:
        return 'image/jpeg';
    }
  }

  public async extractPDF(filePath: string): Promise<Page[]> {
    const dataBuffer = await fs.promises.readFile(filePath);
    const pages: Page[] = [];

    let pageNum = 1;
    const pagerender = async (pageData: any): Promise<string> => {
      try {
        const textContent = await pageData.getTextContent({
          normalizeWhitespace: false,
          disableCombineTextItems: false,
        });

        let lastY: any;
        let text = '';
        for (const item of textContent.items) {
          if (lastY === item.transform[5] || !lastY) {
            text += item.str;
          } else {
            text += '\n' + item.str;
          }
          lastY = item.transform[5];
        }

        const trimmed = text.trim();
        const p = pageData.pageNumber || pageNum;
        pageNum++;

        pages.push({
          page: p,
          text: trimmed,
          isOCR: false,
        });

        return trimmed;
      } catch (err) {
        console.warn(`Error rendering page in pdf-parse:`, err);
        return '';
      }
    };

    try {
      const pdfData = await pdfParse(dataBuffer, { pagerender });
      const totalChars = pdfData.text ? pdfData.text.replace(/\s+/g, '').length : 0;

      // Scanned PDF detection: if total non-whitespace chars < 50, mark as scanned
      if (totalChars < 50) {
        console.log(`Scanned PDF detected (${totalChars} chars) for ${filePath}. Attempting OCR...`);
        return await this.extractScannedPDF(dataBuffer, filePath, pdfData.numpages || 1);
      }

      // Filter out empty pages or keep page numbers consistent
      return pages.map((p, idx) => ({
        ...p,
        page: p.page || idx + 1,
        text: p.text || '[Blank page]',
      }));
    } catch (err) {
      console.error(`Error in pdfParse for ${filePath}:`, err);
      // Fallback: attempt multimodal extraction if supported
      return await this.extractScannedPDF(dataBuffer, filePath, 1);
    }
  }

  private async extractScannedPDF(buffer: Buffer, filePath: string, numPages: number): Promise<Page[]> {
    const genAI = this.getGenAI();
    if (!genAI) {
      return [
        {
          page: 1,
          text: `[Scanned PDF: Document "${path.basename(filePath)}" contains image-only or scanned pages with no embedded text. Provide GEMINI_API_KEY in .env for automated multimodal OCR.]`,
          isOCR: true,
        },
      ];
    }

    try {
      const model = genAI.getGenerativeModel({ model: process.env.LLM_MODEL || 'gemini-3.8-flash' });
      const prompt = `Transcribe ALL text visible in this scanned document, including handwritten notes, printed text, diagrams, formulas, and labels. Preserve page order and paragraph breaks. Output transcribed text only.`;

      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            data: buffer.toString('base64'),
            mimeType: 'application/pdf',
          },
        },
      ]);

      const transcribed = result.response.text();
      return [
        {
          page: 1,
          text: transcribed.trim() || '[Empty OCR result]',
          isOCR: true,
        },
      ];
    } catch (err: any) {
      console.warn(`Gemini Vision PDF OCR failed:`, err?.message || err);
      return [
        {
          page: 1,
          text: `[Scanned PDF: Unable to transcribe pages automatically (${err?.message || 'OCR error'}).]`,
          isOCR: true,
        },
      ];
    }
  }

  public async extractXLSX(filePath: string): Promise<Page[]> {
    const workbook = XLSX.readFile(filePath, { cellDates: true });
    const pages: Page[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: '',
        blankrows: false,
      });

      if (rows.length === 0) continue;

      // Group rows into blocks (e.g. 20 rows per chunk block) for readability
      const batchSize = 25;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const rowStart = i + 1;

        const lines: string[] = [];
        // Include header if available
        if (i > 0 && rows.length > 0 && rows[0].length > 0) {
          const headers = rows[0].map((c) => String(c).trim()).filter(Boolean);
          if (headers.length > 0) {
            lines.push(`Columns: ${headers.join(' | ')}`);
          }
        }

        for (let r = 0; r < batch.length; r++) {
          const rowValues = batch[r]
            .map((c: any) => (c !== null && c !== undefined ? String(c).trim() : ''))
            .filter((c: string) => c.length > 0);

          if (rowValues.length > 0) {
            lines.push(`Row ${rowStart + r}: ${rowValues.join(' | ')}`);
          }
        }

        if (lines.length > 0) {
          pages.push({
            sheet: sheetName,
            rowStart,
            text: lines.join('\n'),
            isOCR: false,
          });
        }
      }
    }

    if (pages.length === 0) {
      pages.push({
        sheet: 'Sheet1',
        rowStart: 1,
        text: '[Empty spreadsheet]',
        isOCR: false,
      });
    }

    return pages;
  }

  public async extractMarkdown(filePath: string): Promise<Page[]> {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const pages: Page[] = [];

    const chunkSize = 40; // ~40 lines per page block
    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunkLines = lines.slice(i, i + chunkSize);
      const text = chunkLines.join('\n').trim();
      if (text) {
        pages.push({
          lineStart: i + 1,
          text,
          isOCR: false,
        });
      }
    }

    if (pages.length === 0) {
      pages.push({ lineStart: 1, text: content.trim() || '[Empty markdown document]', isOCR: false });
    }

    return pages;
  }

  public async extractText(filePath: string): Promise<Page[]> {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const pages: Page[] = [];

    const chunkSize = 40; // ~40 lines per page block
    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunkLines = lines.slice(i, i + chunkSize);
      const text = chunkLines.join('\n').trim();
      if (text) {
        pages.push({
          lineStart: i + 1,
          text,
          isOCR: false,
        });
      }
    }

    if (pages.length === 0) {
      pages.push({ lineStart: 1, text: content.trim() || '[Empty text document]', isOCR: false });
    }

    return pages;
  }

  public async extractImage(filePath: string, mimeType: string): Promise<Page[]> {
    const buffer = await fs.promises.readFile(filePath);
    const genAI = this.getGenAI();

    if (!genAI) {
      return [
        {
          page: 1,
          text: `[Image: ${path.basename(filePath)}. Provide GEMINI_API_KEY in .env for Gemini Vision OCR transcription of handwritten and printed text.]`,
          isOCR: true,
        },
      ];
    }

    try {
      const model = genAI.getGenerativeModel({ model: process.env.LLM_MODEL || 'gemini-3.8-flash' });
      const prompt = `Transcribe ALL text visible in this image, including any handwritten content, printed text, mathematical equations, and diagram labels. Preserve paragraph breaks. Output plain text only.`;

      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            data: buffer.toString('base64'),
            mimeType: mimeType || 'image/jpeg',
          },
        },
      ]);

      const transcribed = result.response.text();
      return [
        {
          page: 1,
          text: transcribed.trim() || '[Empty OCR transcription]',
          isOCR: true,
        },
      ];
    } catch (err: any) {
      console.warn(`Gemini Vision image OCR failed:`, err?.message || err);
      return [
        {
          page: 1,
          text: `[Image OCR error: ${err?.message || 'Could not transcribe image'} (${path.basename(filePath)})]`,
          isOCR: true,
        },
      ];
    }
  }

  /**
   * Microsoft Word (.docx) parser using Mammoth & OMML equation preprocessor
   * Extracts clean text and markdown structures, preserving LaTeX math formulas, vectors, and line numbers.
   */
  public async extractDocx(filePath: string): Promise<Page[]> {
    try {
      let buffer: any = await fs.promises.readFile(filePath);

      // 1. Preprocess DOCX zip to convert Office Math (OMML) <m:oMath> tags to LaTeX
      try {
        const zip = await JSZip.loadAsync(buffer);
        const docXml = zip.file('word/document.xml');
        if (docXml) {
          let xml = await docXml.async('text');
          if (xml.includes('<m:oMath')) {
            xml = this.convertOmmlInWordXml(xml);
            zip.file('word/document.xml', xml);
            buffer = (await zip.generateAsync({ type: 'nodebuffer' })) as unknown as Buffer;
          }
        }
      } catch (zipErr) {
        // If zip preprocessing fails, continue with original buffer
      }

      // 2. Convert using Mammoth, ignoring embedded preview WMF/EMF binaries
      const result = await mammoth.convertToMarkdown(
        { buffer },
        {
          convertImage: mammoth.images.inline(() => Promise.resolve({ src: '' })),
        }
      );
      let textContent = result.value || '';

      if (!textContent.trim()) {
        const raw = await mammoth.extractRawText({ buffer });
        textContent = raw.value || '';
      }

      // 3. Sanitize any remaining raw base64 data URIs or empty markdown image tags
      textContent = textContent
        .replace(/!\[([^\]]*)\]\(data:image\/[a-zA-Z0-9.\-_+]+;base64,[A-Za-z0-9+/=\s]+\)/gi, (_m, alt) => {
          const cleanAlt = alt?.replace(/\\-/g, '-').trim();
          return cleanAlt ? ` [Formula: $${cleanAlt}$] ` : ' [Formula] ';
        })
        .replace(/data:image\/[a-zA-Z0-9.\-_+]+;base64,[A-Za-z0-9+/=\s]{20,}/gi, ' [Formula] ')
        .replace(/!\[\s*\]\(\s*\)/g, '');

      if (!textContent.trim()) {
        return [{ page: 1, lineStart: 1, text: '[Empty Word document]', isOCR: false }];
      }

      // Break into logical paragraph sections (~8 paragraphs per logical page)
      const paragraphs = textContent.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
      const pages: Page[] = [];
      const batchSize = 8;
      let currentLine = 1;

      for (let i = 0; i < paragraphs.length; i += batchSize) {
        const batch = paragraphs.slice(i, i + batchSize);
        const sectionText = batch.join('\n\n');
        pages.push({
          page: Math.floor(i / batchSize) + 1,
          lineStart: currentLine,
          text: sectionText,
          isOCR: false,
        });
        currentLine += sectionText.split('\n').length + 1;
      }

      return pages.length > 0 ? pages : [{ page: 1, lineStart: 1, text: textContent, isOCR: false }];
    } catch (err: any) {
      console.error(`Error parsing DOCX ${filePath}:`, err);
      return this.extractText(filePath);
    }
  }

  /**
   * Converts Office Math Markup Language (OMML) tags into LaTeX equations
   */
  private convertOmmlInWordXml(xml: string): string {
    return xml.replace(/<m:oMath[^>]*>([\s\S]*?)<\/m:oMath>/gi, (_match, mathXml) => {
      let latex = mathXml;

      // Fractions: \frac{num}{den}
      latex = latex.replace(/<m:f[^>]*>[\s\S]*?<m:num[^>]*>([\s\S]*?)<\/m:num>[\s\S]*?<m:den[^>]*>([\s\S]*?)<\/m:den>[\s\S]*?<\/m:f>/gi, '\\frac{$1}{$2}');

      // Superscripts: {base}^{sup}
      latex = latex.replace(/<m:sSup[^>]*>[\s\S]*?<m:e[^>]*>([\s\S]*?)<\/m:e>[\s\S]*?<m:sup[^>]*>([\s\S]*?)<\/m:sup>[\s\S]*?<\/m:sSup>/gi, '{$1}^{$2}');

      // Subscripts: {base}_{sub}
      latex = latex.replace(/<m:sSub[^>]*>[\s\S]*?<m:e[^>]*>([\s\S]*?)<\/m:e>[\s\S]*?<m:sub[^>]*>([\s\S]*?)<\/m:sub>[\s\S]*?<\/m:sSub>/gi, '{$1}_{$2}');

      // Radicals: \sqrt{base}
      latex = latex.replace(/<m:rad[^>]*>[\s\S]*?<m:e[^>]*>([\s\S]*?)<\/m:e>[\s\S]*?<\/m:rad>/gi, '\\sqrt{$1}');

      // Accents / Vectors: \vec{base}
      latex = latex.replace(/<m:acc[^>]*>[\s\S]*?<m:e[^>]*>([\s\S]*?)<\/m:e>[\s\S]*?<\/m:acc>/gi, '\\vec{$1}');

      // Delimiters: \left( base \right)
      latex = latex.replace(/<m:d[^>]*>[\s\S]*?<m:e[^>]*>([\s\S]*?)<\/m:e>[\s\S]*?<\/m:d>/gi, '\\left( $1 \\right)');

      // Extract text content from <m:t> tags
      const textPieces: string[] = [];
      const tMatches = latex.matchAll(/<m:t[^>]*>([\s\S]*?)<\/m:t>/gi);
      for (const tm of tMatches) {
        if (tm[1]) textPieces.push(tm[1]);
      }

      // Strip remaining XML tags
      let clean = latex.replace(/<[^>]+>/g, '').trim();
      if (!clean && textPieces.length > 0) {
        clean = textPieces.join('');
      }

      if (clean) {
        return `<w:r><w:t xml:space="preserve"> $${clean}$ </w:t></w:r>`;
      }
      return '';
    });
  }

  /**
   * Microsoft PowerPoint (.pptx) parser using JSZip
   * Extracts text slide-by-slide preserving exact slide numbers (Page 1 = Slide 1).
   */
  public async extractPptx(filePath: string): Promise<Page[]> {
    try {
      const buffer = await fs.promises.readFile(filePath);
      const zip = await JSZip.loadAsync(buffer);
      const pages: Page[] = [];

      const slideEntries: { num: number; file: JSZip.JSZipObject }[] = [];
      const slideRegex = /ppt\/slides\/slide(\d+)\.xml$/i;

      zip.forEach((relativePath, file) => {
        const match = relativePath.match(slideRegex);
        if (match) {
          slideEntries.push({ num: parseInt(match[1], 10), file });
        }
      });

      // Sort slides in presentation order
      slideEntries.sort((a, b) => a.num - b.num);

      for (const entry of slideEntries) {
        const xmlContent = await entry.file.async('text');
        // Extract text inside <a:t> tags
        const textMatches = xmlContent.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi) || [];
        const slideLines: string[] = [];

        for (const tag of textMatches) {
          const inner = tag.replace(/<\/?a:t[^>]*>/gi, '').trim();
          if (inner) {
            slideLines.push(inner);
          }
        }

        const slideText = slideLines.join(' ').replace(/\s+/g, ' ').trim();
        pages.push({
          page: entry.num, // Exact Slide number for clickable citations
          text: slideText ? `[Slide ${entry.num}]\n${slideText}` : `[Slide ${entry.num} - Empty or Graphic only]`,
          isOCR: false,
        });
      }

      return pages.length > 0 ? pages : [{ page: 1, text: '[Empty PowerPoint Presentation]', isOCR: false }];
    } catch (err: any) {
      console.error(`Error parsing PPTX ${filePath}:`, err);
      return [{ page: 1, text: `[PowerPoint Presentation: could not extract slides automatically (${err?.message})].`, isOCR: false }];
    }
  }

  /**
   * OpenDocument Text (.odt) parser using JSZip
   */
  public async extractOdt(filePath: string): Promise<Page[]> {
    try {
      const buffer = await fs.promises.readFile(filePath);
      const zip = await JSZip.loadAsync(buffer);
      const contentFile = zip.file('content.xml');

      if (!contentFile) {
        return this.extractText(filePath);
      }

      const xml = await contentFile.async('text');
      const matches = xml.match(/<text:[ph][^>]*>([\s\S]*?)<\/text:[ph]>/gi) || [];
      const lines: string[] = [];

      for (const m of matches) {
        const clean = m.replace(/<[^>]+>/g, '').trim();
        if (clean) lines.push(clean);
      }

      const pages: Page[] = [];
      const batchSize = 15;
      for (let i = 0; i < lines.length; i += batchSize) {
        const chunk = lines.slice(i, i + batchSize);
        pages.push({
          page: Math.floor(i / batchSize) + 1,
          lineStart: i + 1,
          text: chunk.join('\n\n'),
          isOCR: false,
        });
      }

      return pages.length > 0 ? pages : [{ lineStart: 1, text: '[Empty OpenDocument Text]', isOCR: false }];
    } catch (err: any) {
      console.error(`Error parsing ODT ${filePath}:`, err);
      return this.extractText(filePath);
    }
  }

  /**
   * Rich Text Format (.rtf) parser
   */
  public async extractRTF(filePath: string): Promise<Page[]> {
    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8');
      const cleaned = raw
        .replace(/\\par[d]?/g, '\n')
        .replace(/\\tab/g, '\t')
        .replace(/\\'[0-9a-fA-F]{2}/g, '')
        .replace(/\\[a-zA-Z]+(-?[0-9]+)? ?/g, '')
        .replace(/[{}]/g, '');

      const lines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const pages: Page[] = [];
      const batchSize = 25;

      for (let i = 0; i < lines.length; i += batchSize) {
        pages.push({
          page: Math.floor(i / batchSize) + 1,
          lineStart: i + 1,
          text: lines.slice(i, i + batchSize).join('\n'),
          isOCR: false,
        });
      }

      return pages.length > 0 ? pages : [{ lineStart: 1, text: '[Empty RTF Document]', isOCR: false }];
    } catch (err: any) {
      return this.extractText(filePath);
    }
  }

  /**
   * HTML Web Page parser (.html, .htm)
   */
  public async extractHTML(filePath: string): Promise<Page[]> {
    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8');
      const noScript = raw.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
      const withNewlines = noScript
        .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n');
      const textOnly = withNewlines.replace(/<[^>]+>/g, '');
      const decoded = textOnly
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

      const lines = decoded.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const pages: Page[] = [];
      const batchSize = 25;

      for (let i = 0; i < lines.length; i += batchSize) {
        pages.push({
          page: Math.floor(i / batchSize) + 1,
          lineStart: i + 1,
          text: lines.slice(i, i + batchSize).join('\n'),
          isOCR: false,
        });
      }

      return pages.length > 0 ? pages : [{ lineStart: 1, text: '[Empty HTML Document]', isOCR: false }];
    } catch (err: any) {
      return this.extractText(filePath);
    }
  }

  /**
   * JSON & JSONL parser (.json, .jsonl)
   */
  public async extractJSON(filePath: string): Promise<Page[]> {
    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8');
      let prettyText = '';

      try {
        const parsed = JSON.parse(raw);
        prettyText = JSON.stringify(parsed, null, 2);
      } catch {
        // May be JSONL (newline-delimited JSON)
        prettyText = raw;
      }

      const lines = prettyText.split('\n');
      const pages: Page[] = [];
      const batchSize = 35;

      for (let i = 0; i < lines.length; i += batchSize) {
        pages.push({
          page: Math.floor(i / batchSize) + 1,
          lineStart: i + 1,
          text: lines.slice(i, i + batchSize).join('\n'),
          isOCR: false,
        });
      }

      return pages.length > 0 ? pages : [{ lineStart: 1, text: prettyText, isOCR: false }];
    } catch (err: any) {
      return this.extractText(filePath);
    }
  }

  /**
   * XML parser (.xml)
   */
  public async extractXML(filePath: string): Promise<Page[]> {
    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8');
      const cleanText = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const words = cleanText.split(' ');
      const pages: Page[] = [];
      const batchSize = 300;

      for (let i = 0; i < words.length; i += batchSize) {
        pages.push({
          page: Math.floor(i / batchSize) + 1,
          lineStart: i + 1,
          text: words.slice(i, i + batchSize).join(' '),
          isOCR: false,
        });
      }

      return pages.length > 0 ? pages : [{ lineStart: 1, text: cleanText || '[Empty XML]', isOCR: false }];
    } catch (err: any) {
      return this.extractText(filePath);
    }
  }

  /**
   * Legacy Office binary formats (.doc, .ppt, .odp)
   */
  public async extractLegacyOffice(filePath: string, ext: string): Promise<Page[]> {
    try {
      const buffer = await fs.promises.readFile(filePath);
      // Extract printable character runs (ASCII + basic Unicode)
      const asciiMatches = buffer.toString('utf-8').match(/[A-Za-z0-9\s.,!?:;'"()\-_/\\%$#@&]{4,}/g) || [];
      const extracted = asciiMatches.join(' ').replace(/\s+/g, ' ').trim();

      if (extracted.length > 100) {
        return [
          {
            page: 1,
            lineStart: 1,
            text: `[Legacy Office Document: ${path.basename(filePath)}]\n${extracted}`,
            isOCR: false,
          },
        ];
      }

      // If binary text extraction is insufficient and Gemini is available, attempt multimodal fallback
      const genAI = this.getGenAI();
      if (genAI) {
        try {
          const model = genAI.getGenerativeModel({ model: process.env.LLM_MODEL || 'gemini-3.8-flash' });
          const result = await model.generateContent([
            `Extract and transcribe all readable text and content from this document (${path.basename(filePath)}).`,
            {
              inlineData: {
                data: buffer.toString('base64'),
                mimeType: ext === '.doc' ? 'application/msword' : 'application/octet-stream',
              },
            },
          ]);
          return [{ page: 1, text: result.response.text().trim(), isOCR: true }];
        } catch {
          // ignore fallback error
        }
      }

      return [
        {
          page: 1,
          text: `[Legacy format ${ext}: Note: For best formatting, save as modern .docx or .pptx. Partial content extracted:\n${extracted || 'No readable text'}]`,
          isOCR: false,
        },
      ];
    } catch (err: any) {
      return this.extractText(filePath);
    }
  }
}

export const extractionService = new ExtractionService();
