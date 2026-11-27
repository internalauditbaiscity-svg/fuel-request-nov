import { Download } from 'lucide-react';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { GeneratedPdfResult } from '../utils/pdfGenerator';

interface PdfPreviewModalProps {
  pdf: GeneratedPdfResult | null;
  onClose: () => void;
}

export function PdfPreviewModal({ pdf, onClose }: PdfPreviewModalProps) {
  useEscapeClose(Boolean(pdf), onClose, 4);

  if (!pdf) return null;

  const handleDownload = () => {
    pdf.doc.save(pdf.filename);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0B192C]/70 p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={pdf.title}
      data-testid="pdf-full-report-modal"
    >
      <div className="flex h-[90vh] w-full max-w-[96vw] sm:max-w-4xl flex-col rounded-lg border border-[#D5DCE6] bg-white overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-[#D5DCE6] px-3 py-2.5 sm:px-4 sm:py-3 shrink-0">
          <div className="min-w-0">
            <h2 className="font-display text-xs sm:text-sm font-bold text-[#0B192C] truncate">
              {pdf.title}
            </h2>
            <p className="font-mono text-[10px] sm:text-[11px] text-[#5A6F8C] truncate">
              {pdf.filename}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleDownload}
              data-testid="pdf-confirm-download-btn"
              className="inline-flex items-center gap-1 rounded-md bg-[#0B192C] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1B3B6F] whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close PDF preview"
              data-testid="pdf-preview-close-btn"
              className="inline-flex items-center justify-center rounded-md bg-[#334E73] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1B3B6F] transition-colors whitespace-nowrap shrink-0"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 bg-[#E6EBF2] p-2 sm:p-3 overflow-hidden">
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
