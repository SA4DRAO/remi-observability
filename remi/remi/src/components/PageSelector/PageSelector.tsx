import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

interface PageSelectorProps {
  pages: string[];
  selectedPageId: string;
  onSelectPage: (pageId: string) => void;
  loading?: boolean;
}

export const PageSelector = ({
  pages,
  selectedPageId,
  onSelectPage,
  loading = false,
}: PageSelectorProps) => {
  const items = pages.length === 0 ? ["default"] : pages;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="page-select">Session</Label>
      <Select value={selectedPageId} onValueChange={onSelectPage} disabled={loading}>
        <SelectTrigger id="page-select">
          <SelectValue placeholder="Select session" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((pageId) => (
              <SelectItem key={pageId} value={pageId}>
                {pageId}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {loading && (
        <span className="text-xs text-muted-foreground">Loading...</span>
      )}
    </div>
  );
};
