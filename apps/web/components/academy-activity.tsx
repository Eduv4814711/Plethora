import Link from "next/link";

export type AcademyActivityItem = {
  id: string;
  at: string;
  label: string;
  userName: string | null;
  link: string | null;
};

export function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function AcademyActivityRow({ item, compact }: { item: AcademyActivityItem; compact?: boolean }) {
  const inner = (
    <>
      <p className={compact ? "text-security-navy-800 line-clamp-2" : "text-security-navy-800"}>{item.label}</p>
      <p className="mt-0.5 text-xs text-neutral-500">
        {timeAgo(item.at)}
        {item.userName ? ` · ${item.userName}` : ""}
      </p>
    </>
  );
  if (item.link) {
    return (
      <Link
        href={item.link}
        className="block rounded-xl border border-transparent bg-white/60 p-2.5 text-sm transition hover:border-neutral-300"
      >
        {inner}
      </Link>
    );
  }
  return <div className="rounded-xl border border-neutral-200/80 bg-white/60 p-2.5 text-sm">{inner}</div>;
}
