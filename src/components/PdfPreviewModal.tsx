import { Download, X } from 'lucide-react';
import { GeneratedPdfResult } from '../utils/pdfGenerator';

interface PdfPreviewModalProps {
  pdf: GeneratedPdfResult | null;
  onClose: () => void;
}

export function PdfPreviewModal({ pdf, onClose }: PdfPreviewModalProps) {
  if (!pdf) return null;

  const handleDownload = () => {
    pdf.doc.save(pdf.filename);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B192C]/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={pdf.title}
    >
      <div className="flex h-[88vh] w-full max-w-4xl flex-col rounded-lg border border-[#D5DCE6] bg-white">
        <div className="flex items-center justify-between gap-4 border-b border-[#D5DCE6] px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold text-[#0B192C] truncate">
              {pdf.title}
            </h2>
            <p className="font-mono text-xs text-[#5A6F8C] truncate">{pdf.filename}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#0B192C] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1B3B6F] whitespace-nowrap"
            >
              <Download className="h-4 w-4" />
              <span>Download PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close PDF preview"
              className="rounded-md border border-[#D5DCE6] p-2 text-[#334E73] hover:bg-[#F3F5F8]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 bg-[#E6EBF2] p-3 overflow-hidden">
          <iframe
            src={pdf.blobUrl}
            title={pdf.title}
            className="h-full w-full rounded border border-[#D5DCE6] bg-white"
          />
        </div>
      </div>
    </div>
  );
}
