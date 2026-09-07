type EmptySlotProps = {
  hint: string;
  title: string;
};

/**
 * 尚未实现的功能占位块。写清楚"还没做"，避免被误当成故障。
 */
export function EmptySlot({ hint, title }: EmptySlotProps) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 px-5 py-8 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      <p className="mt-1.5 text-sm leading-6 text-slate-500">{hint}</p>
    </div>
  );
}
