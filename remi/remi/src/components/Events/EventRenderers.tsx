/**
 * Reusable rendering components for event details
 * Extracted from EventDetailContent to reduce code duplication
 */

import type { ReactNode } from "react";

// Color themes for different event types
export const colorThemes = {
  purple: "bg-purple-50 dark:bg-purple-950 border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300",
  green: "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300",
  blue: "bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300",
  orange: "bg-orange-50 dark:bg-orange-950 border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-300",
  red: "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300",
  cyan: "bg-cyan-50 dark:bg-cyan-950 border-cyan-200 dark:border-cyan-800 text-cyan-700 dark:text-cyan-300",
  gray: "bg-gray-50 dark:bg-gray-950 border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300",
} as const;

interface SectionProps {
  title: ReactNode;
  children: ReactNode;
}

export function Section({ title, children }: SectionProps) {
  return (
    <div>
      <h3 className="flex items-center gap-1.5 font-semibold mb-2 text-sm">{title}</h3>
      {children}
    </div>
  );
}

interface CodeBlockProps {
  content: unknown;
  theme?: keyof typeof colorThemes;
  label?: string;
}

export function CodeBlock({ content, theme = "gray", label }: CodeBlockProps) {
  const colorClass = colorThemes[theme];
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);

  return (
    <div className={`border rounded-lg p-3 ${colorClass}`}>
      {label && <div className="text-xs font-semibold mb-2 opacity-80">{label}</div>}
      <pre className="text-xs overflow-x-auto whitespace-pre-wrap">{text}</pre>
    </div>
  );
}

interface MetadataRowProps {
  label: string;
  value: string | number;
  valueClassName?: string;
}

export function MetadataRow({ label, value, valueClassName }: MetadataRowProps) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}:</span>
      <span className={`font-medium ${valueClassName || ""}`}>{value}</span>
    </div>
  );
}

interface MetricBoxProps {
  label: string;
  value: string;
  color: "blue" | "green" | "purple";
}

export function MetricBox({ label, value, color }: MetricBoxProps) {
  const colorClasses = {
    blue: "bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400",
    green: "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800 text-green-600 dark:text-green-400",
    purple: "bg-purple-50 dark:bg-purple-950 border-purple-200 dark:border-purple-800 text-purple-600 dark:text-purple-400",
  };

  return (
    <div className={`border rounded-lg p-3 ${colorClasses[color]}`}>
      <div className="text-xs">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

interface TokenMetricProps {
  label: string;
  value: number;
}

export function TokenMetric({ label, value }: TokenMetricProps) {
  return (
    <div className="bg-muted rounded-lg p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

// Utility to render a value if it exists
export function renderIfExists(
  value: unknown,
  renderer: (val: any) => ReactNode
): ReactNode | null {
  if (value === undefined || value === null) return null;
  return renderer(value);
}

// Utility to format bytes as KB
export function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} KB`;
}
