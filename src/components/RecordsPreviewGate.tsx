import { ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface RecordsPreviewGateProps {
  title: string;
  description: string;
  recordCount: number;
  previewOpen: boolean;
  onTogglePreview: (open: boolean) => void;
  buttonLabel?: string;
  children: ReactNode;
}

export function RecordsPreviewGate({
  title,
  description,
  recordCount,
  previewOpen,
  onTogglePreview,
  buttonLabel = 'Preview',
  children,
}: RecordsPreviewGateProps) {
  if (!previewOpen) {
    return (
      <section className="rounded-lg border border-[#D5DCE6] bg-white p-8 text-center space-y-3">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-[#EEF2F8] text-[#1B3B6F]">
          <Eye className="h-5 w-5" />
        </div>
        <div className="space-y-1 max-w-md mx-auto">
          <h2 className="font-display text-base font-bold text-[#0B192C]">{title}</h2>
          <p className="text-xs text-[#5A6F8C] leading-relaxed">{description}</p>
        </div>
        <div className="pt-1 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => onTogglePreview(true)}
            className="inline-flex items-center gap-2 rounded-md bg-[#0B192C] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#1B3B6F] transition-colors"
          >
            <Eye className="h-4 w-4" />
            <span>
              {buttonLabel} ({recordCount})
            </span>
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-md border border-[#D5DCE6] bg-[#F9FAFC] px-4 py-2 text-xs">
        <span className="font-semibold text-[#334E73]">
          Showing {title} ({recordCount} record{recordCount === 1 ? '' : 's'})
        </span>
        <button
          type="button"
          onClick={() => onTogglePreview(false)}
          className="inline-flex items-center gap-1.5 rounded border border-[#D5DCE6] bg-white px-2.5 py-1 text-xs font-semibold text-[#334E73] hover:bg-[#F3F5F8]"
        >
          <EyeOff className="h-3.5 w-3.5" />
          <span>Hide Preview</span>
        </button>
      </div>
      {children}
    </div>
  );
}
