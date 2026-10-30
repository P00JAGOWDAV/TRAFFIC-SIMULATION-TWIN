import { Activity, GitCompare, LayoutDashboard, ShieldAlert } from 'lucide-react';

export const NAV_ITEMS = [
  {
    id: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    title: 'Overview',
    subtitle: 'Decision summary for the selected traffic scenario',
  },
  {
    id: 'simulation',
    label: 'Simulation',
    icon: Activity,
    title: 'Simulation',
    subtitle: 'Intersection state, signal timing and queue evolution',
  },
  {
    id: 'comparison',
    label: 'Plan Comparison',
    icon: GitCompare,
    title: 'Plan Comparison',
    subtitle: 'Side-by-side performance and explainable scoring',
  },
  {
    id: 'stress',
    label: 'Stress Testing',
    icon: ShieldAlert,
    title: 'Stress Testing',
    subtitle: 'How each plan holds up across every scenario',
  },
];
