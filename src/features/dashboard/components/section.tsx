type SectionProps = {
  action?: React.ReactNode;
  badge?: string;
  children: React.ReactNode;
  description?: string;
  title: string;
};

export function Section({
  action,
  badge,
  children,
  description,
  title,
}: SectionProps) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
            {badge ? (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                {badge}
              </span>
            ) : null}
          </div>
          {description ? (
            <p className="mt-1.5 text-sm leading-6 text-slate-600">
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
