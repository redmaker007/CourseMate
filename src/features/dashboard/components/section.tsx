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
    <section>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {badge ? (
              <span className="rounded-full bg-panel px-2 py-0.5 text-xs font-medium text-muted">
                {badge}
              </span>
            ) : null}
          </div>
          {description ? (
            <p className="mt-1 text-xs text-muted">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
