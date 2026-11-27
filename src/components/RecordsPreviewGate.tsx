import { ReactNode } from 'react';
import { Eye } from 'lucide-react';
import { useEscapeClose } from '../hooks/useEscapeClose';

interface RecordsPreviewGateProps {
  title: string;
  description?: string;
  recordCount: number;
  previewOpen: boolean;
  onTogglePreview: (open: boolean) => void;
  buttonLabel?: string;
  disabled?: boolean;
  disabledReason?: string;
  headerActions?: ReactNode;
  maxWidthClass?: string;
  children: ReactNode;
}

export function RecordsPreviewGate({
  title,
  description,
  recordCount,
  previewOpen,
  onTogglePreview,
  buttonLabel = 'Preview',
  disabled = false,
  disabledReason,
  headerActions,
  maxWidthClass = 'max-w-[96vw] sm:max-w-xl md:max-w-2xl',
  children,
}: RecordsPreviewGateProps) {
  const isFloatingOpen = previewOpen && !disabled;

  useEscapeClose(isFloatingOpen, () => onTogglePreview(false), 1);

  return (
    <>
      <section className="rounded-lg border border-[#D5DCE6] bg-white px-3.5 py-3 sm:px-4 sm:py-3.5">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-[#1B3B6F] shrink-0" />
              <h2 className="font-display text-xs sm:text-sm font-bold text-[#0B192C] truncate">
                {title}
              </h2>
            </div>
            {description && (
              <p className="hidden sm:block text-[11px] text-[#5A6F8C] truncate">{description}</p>
            )}
            {disabled && disabledReason && (
              <p className="text-[11px] font-medium text-[#5A6F8C]" role="status">
                {disabledReason}
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (!disabled) onTogglePreview(!previewOpen);
            }}
            className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-md bg-[#0B192C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1B3B6F] transition-colors whitespace-nowrap shrink-0 disabled:cursor-not-allowed disabled:bg-[#94A3B8] disabled:hover:bg-[#94A3B8]"
          >
            <Eye className="h-3.5 w-3.5" />
            <span>
              {isFloatingOpen ? `Preview Open (${recordCount})` : `${buttonLabel} (${recordCount})`}
            </span>
          </button>
        </div>
      </section>

      {isFloatingOpen && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-[#0B192C]/55 p-2 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          data-testid="floating-records-preview"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              onTogglePreview(false);
            }
          }}
        >
          <div
            className={`flex max-h-[90vh] w-full ${maxWidthClass} flex-col rounded-lg border border-[#1B3B6F]/30 bg-[#F8FAFC] shadow-2xl overflow-hidden`}
          >
            <div className="flex items-center justify-between gap-2 border-b border-[#D5DCE6] bg-white px-3 py-2 sm:px-4 sm:py-2.5 shrink-0">
              <div className="min-w-0">
                <h2 className="font-display text-xs sm:text-sm font-bold text-[#0B192C] truncate">
                  {title}
                </h2>
                <p className="font-mono text-[10px] sm:text-[11px] font-medium text-[#5A6F8C]">
                  {recordCount} record{recordCount === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {headerActions}
                <button
                  type="button"
                  onClick={() => onTogglePreview(false)}
                  aria-label={`Close ${title}`}
                  data-testid="floating-preview-close-btn"
                  className="inline-flex items-center justify-center rounded-md bg-[#0B192C] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1B3B6F] transition-colors whitespace-nowrap shrink-0"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 sm:p-3 space-y-2.5">
              {children}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

