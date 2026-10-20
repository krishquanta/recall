import React, { useRef } from 'react';
import {
  UploadCloud,
  FileText,
  Image as ImageIcon,
  Table,
  FileCode,
  Presentation,
} from 'lucide-react';
import { useUpload } from '../../hooks/useUpload';
import clsx from 'clsx';

interface UploadDropzoneProps {
  compact?: boolean;
}

const ACCEPTED_FORMATS =
  '.pdf,.docx,.doc,.pptx,.ppt,.odt,.odp,.ods,.rtf,.xlsx,.xls,.csv,.tsv,.md,.markdown,.txt,.text,.html,.htm,.json,.jsonl,.xml,.png,.jpg,.jpeg,.webp,.heic';

export const UploadDropzone: React.FC<UploadDropzoneProps> = ({ compact = false }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { isDragOver, handleUploadFile, handleDrop, handleDragOver, handleDragLeave } = useUpload();

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      Array.from(e.target.files).forEach((file) => {
        handleUploadFile(file);
      });
      e.target.value = '';
    }
  };

  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  if (compact) {
    return (
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={openFileDialog}
        className={clsx(
          'w-full py-2.5 px-3 rounded-lg border-2 border-dashed text-center cursor-pointer transition-all duration-200 flex items-center justify-center gap-2 group',
          isDragOver
            ? 'border-indigo-500 bg-indigo-50/70 text-indigo-700 scale-[0.99]'
            : 'border-slate-300 hover:border-indigo-400 bg-white/70 hover:bg-indigo-50/30 text-slate-600'
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_FORMATS}
          className="hidden"
          onChange={onFileInputChange}
        />
        <UploadCloud className="w-4 h-4 text-indigo-600 group-hover:scale-110 transition-transform" />
        <span className="text-xs font-medium">Add or Drop Files</span>
      </div>
    );
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={openFileDialog}
      className={clsx(
        'w-full p-4 rounded-xl border-2 border-dashed text-center cursor-pointer transition-all duration-200 relative overflow-hidden group',
        isDragOver
          ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-md ring-2 ring-indigo-200'
          : 'border-slate-200 hover:border-indigo-400 bg-white hover:bg-slate-50/80 text-slate-600 shadow-sm'
      )}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_FORMATS}
        className="hidden"
        onChange={onFileInputChange}
      />

      <div className="flex flex-col items-center gap-2">
        <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 group-hover:scale-110 transition-transform">
          <UploadCloud className="w-5 h-5" />
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-800">
            Click to upload or drag & drop
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Word, PowerPoint, PDF, Excel, Markdown, or Handwritten Scans
          </p>
        </div>

        {/* Supported badges */}
        <div className="flex flex-wrap items-center justify-center gap-1 mt-1">
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-blue-50 text-blue-700 rounded border border-blue-200" title="Word (.docx, .doc, .odt, .rtf)">
            <FileText className="w-2.5 h-2.5" /> Word/DOCX
          </span>
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-700 rounded border border-amber-200" title="PowerPoint (.pptx, .ppt, .odp)">
            <Presentation className="w-2.5 h-2.5" /> PPTX/Slides
          </span>
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-red-50 text-red-700 rounded border border-red-200" title="PDF Documents">
            <FileText className="w-2.5 h-2.5" /> PDF
          </span>
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-emerald-50 text-emerald-700 rounded border border-emerald-200" title="Spreadsheets (.xlsx, .csv, .tsv, .ods)">
            <Table className="w-2.5 h-2.5" /> Excel/CSV
          </span>
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-cyan-50 text-cyan-700 rounded border border-cyan-200" title="Text & Code (.md, .txt, .json, .html, .xml)">
            <FileCode className="w-2.5 h-2.5" /> Text/MD
          </span>
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-purple-50 text-purple-700 rounded border border-purple-200" title="Images & Handwriting OCR (.png, .jpg, .webp)">
            <ImageIcon className="w-2.5 h-2.5" /> Image/OCR
          </span>
        </div>
      </div>
    </div>
  );
};
