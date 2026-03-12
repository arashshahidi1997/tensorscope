type PlaceholderTabProps = {
  label: string;
};

export function PlaceholderTab({ label }: PlaceholderTabProps) {
  return (
    <div className="panel">
      <p className="muted">{label}</p>
    </div>
  );
}
