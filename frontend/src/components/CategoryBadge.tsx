import { CATEGORIES, type Category } from "@/lib/data";

export function CategoryBadge({ category, size = "sm" }: { category: Category; size?: "sm" | "md" }) {
  const meta = CATEGORIES[category];
  const sizing = size === "md" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-medium ring-1 ring-inset ${meta.badge} ${sizing}`}>
      {meta.label}
    </span>
  );
}
