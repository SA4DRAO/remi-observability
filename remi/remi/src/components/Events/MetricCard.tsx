import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

interface MetricCardProps {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}

export function MetricCard({ title, icon, children }: MetricCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

interface MetricItemProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
}

export function MetricItem({ label, value, icon }: MetricItemProps) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground flex items-center gap-2">
        {icon}
        {label}
      </span>
      <span className="text-lg font-semibold">{value}</span>
    </div>
  );
}
