# PRD — Product Requirements Document
> **What you're building, why, who it's for, and its features**

---

## Problem Statement

Students and self-learners struggle to extract targeted knowledge from dense PDF textbooks, lecture
slides, Excel data sheets, and Markdown notes. Existing tools force them to manually search and
cross-reference pages. **Smart Teacher** replaces that friction with a conversational AI that
knows exactly where every answer comes from.

---

## Target Users

| Persona | Use-case |
|---------|----------|
| University student | Upload lecture slides + textbook PDFs; quiz themselves before exams |
| Self-learner / hobbyist | Import Markdown notes + e-books and explore concepts conversationally |
| Corporate trainer | Share Excel data sheets + policy PDFs; let employees query them |

---

## Goals & Non-Goals

**Goals**
- Upload PDFs, Markdown, Excel (`.xlsx`/`.csv`), plain-text files, and images of handwritten notes.
- Extract, chunk, and index text while preserving page / row / line origin metadata.
- Answer natural-language questions with inline, clickable citations that jump to the source page.
- Keyword + semantic (vector) hybrid search.
- Real-time document processing status and error reporting.

**Non-goals (v1)**
- Audio / video ingestion.
- Multi-user collaboration / shared libraries.
- Mobile-native app (web-first).

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Answer retrieval accuracy (MRR@5) | ≥ 0.80 on internal test set |
| Citation click-through rate | ≥ 60 % of Q&A sessions |
| Document processing time (10 MB PDF) | ≤ 30 s |
| P95 query latency | ≤ 4 s |

---

## Feature List

| # | Feature | Priority |
|---|---------|----------|
| F1 | Multi-format file upload (PDF, MD, XLSX, TXT, PNG, JPG, WEBP, HEIC) | P0 |
| F2 | Text extraction with source-location metadata | P0 |
| F3 | Semantic + keyword hybrid search | P0 |
| F4 | Q&A with clickable citations | P0 |
| F5 | Processing status dashboard (pending / running / done / error) | P0 |
| F6 | **Handwriting & image OCR** via Gemini Vision (photos of notes, whiteboards, scanned pages) | P0 |
| F7 | Scanned PDF detection — fallback to Gemini Vision when pdf-parse yields no text | P0 |
| F8 | Document library management (list, delete, re-index) | P1 |
| F9 | Chat history persistence | P1 |
| F10 | Export answers as annotated PDF | P2 |
