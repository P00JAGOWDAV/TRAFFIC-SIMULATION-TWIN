export default function Panel({ title, subtitle, icon: Icon, actions, children, className = '', bodyClassName = '', id }) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className={`panel ${className}`} aria-labelledby={headingId}>
      {(title || actions) && (
        <header className="panel-head">
          {Icon && (
            <span className="panel-icon" aria-hidden="true">
              <Icon size={17} />
            </span>
          )}
          <div>
            {title && (
              <h2 className="panel-title" id={headingId}>
                {title}
              </h2>
            )}
            {subtitle && <p className="panel-sub">{subtitle}</p>}
          </div>
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      <div className={`panel-body ${bodyClassName}`}>{children}</div>
    </section>
  );
}
