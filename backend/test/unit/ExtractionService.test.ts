import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import JSZip from 'jszip';
import { extractionService } from '../../src/services/ExtractionService';

describe('ExtractionService', () => {
  const fixturesDir = path.join(__dirname, '../fixtures');
  const tempDocxPath = path.join(fixturesDir, 'temp_test.docx');
  const tempPptxPath = path.join(fixturesDir, 'temp_test.pptx');

  beforeAll(async () => {
    // 1. Create a minimal valid DOCX file for testing mammoth extraction
    const docxZip = new JSZip();
    docxZip.file(
      'word/document.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:t>Transformers and Self-Attention Mechanisms in Deep Learning.</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`
    );
    docxZip.file(
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml" />
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" />
</Types>`
    );
    const docxBuffer = await docxZip.generateAsync({ type: 'nodebuffer' });
    await fs.promises.writeFile(tempDocxPath, docxBuffer);

    // 2. Create a minimal valid PPTX file for testing slide extraction
    const pptxZip = new JSZip();
    pptxZip.file(
      'ppt/slides/slide1.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:p>
            <a:r>
              <a:t>Convolutional Neural Networks Architecture</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`
    );
    pptxZip.file(
      'ppt/slides/slide2.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:p>
            <a:r>
              <a:t>Feature Maps and Max Pooling Layers</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`
    );
    const pptxBuffer = await pptxZip.generateAsync({ type: 'nodebuffer' });
    await fs.promises.writeFile(tempPptxPath, pptxBuffer);
  });

  afterAll(async () => {
    if (fs.existsSync(tempDocxPath)) await fs.promises.unlink(tempDocxPath).catch(() => {});
    if (fs.existsSync(tempPptxPath)) await fs.promises.unlink(tempPptxPath).catch(() => {});
  });

  it('should extract markdown with lineStart metadata', async () => {
    const mdPath = path.join(fixturesDir, 'sample.md');
    const pages = await extractionService.extract(mdPath, 'text/markdown');

    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0].lineStart).toBe(1);
    expect(pages[0].text).toContain('Central Limit Theorem');
    expect(pages[0].isOCR).toBe(false);
  });

  it('should extract plain text with lineStart metadata', async () => {
    const txtPath = path.join(fixturesDir, 'sample.txt');
    const pages = await extractionService.extract(txtPath, 'text/plain');

    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0].lineStart).toBe(1);
    expect(pages[0].text).toContain('Supervised learning');
    expect(pages[0].isOCR).toBe(false);
  });

  it('should extract CSV/spreadsheet with rowStart metadata', async () => {
    const csvPath = path.join(fixturesDir, 'sample.csv');
    const pages = await extractionService.extract(csvPath, 'text/csv');

    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0].rowStart).toBe(1);
    expect(pages[0].text).toContain('Gradient Descent');
    expect(pages[0].isOCR).toBe(false);
  });

  it('should extract Microsoft Word (.docx) documents', async () => {
    const pages = await extractionService.extract(
      tempDocxPath,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'temp_test.docx'
    );

    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0].text).toContain('Transformers');
    expect(pages[0].text).toContain('Deep Learning');
    expect(pages[0].page).toBe(1);
    expect(pages[0].isOCR).toBe(false);
  });

  it('should extract Microsoft PowerPoint (.pptx) slide by slide with exact slide numbers', async () => {
    const pages = await extractionService.extract(
      tempPptxPath,
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'temp_test.pptx'
    );

    expect(pages.length).toBe(2);
    expect(pages[0].page).toBe(1);
    expect(pages[0].text).toContain('Convolutional Neural Networks');
    expect(pages[1].page).toBe(2);
    expect(pages[1].text).toContain('Feature Maps and Max Pooling');
  });

  it('should extract HTML web documents stripping scripts and styling', async () => {
    const htmlPath = path.join(fixturesDir, 'sample.html');
    const pages = await extractionService.extract(htmlPath, 'text/html', 'sample.html');

    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0].text).toContain('Deep Learning Overview');
    expect(pages[0].text).toContain('backpropagation');
    expect(pages[0].lineStart).toBe(1);
  });

  it('should extract JSON structured datasets', async () => {
    const jsonPath = path.join(fixturesDir, 'sample.json');
    const pages = await extractionService.extract(jsonPath, 'application/json', 'sample.json');

    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0].text).toContain('Random Forest');
    expect(pages[0].text).toContain('Support Vector Machine');
  });

  it('should extract XML documents with tag stripping', async () => {
    const xmlPath = path.join(fixturesDir, 'sample.xml');
    const pages = await extractionService.extract(xmlPath, 'text/xml', 'sample.xml');

    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0].text).toContain('Binary search trees');
  });

  it('should extract RTF rich text documents', async () => {
    const rtfPath = path.join(fixturesDir, 'sample.rtf');
    const pages = await extractionService.extract(rtfPath, 'application/rtf', 'sample.rtf');

    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0].text).toContain('Quantum Computing Intro');
    expect(pages[0].text).toContain('superposition and entanglement');
  });
});
