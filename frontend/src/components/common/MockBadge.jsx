import { FlaskConical } from 'lucide-react';

export default function MockBadge({ label = 'Simulated · mock data' }) {
  return (
    <span className="mock-badge" title="Generated in the browser from local mock data. Not real traffic data.">
      <FlaskConical size={12} aria-hidden="true" />
      {label}
    </span>
  );
}
