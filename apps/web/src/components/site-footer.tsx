import Link from 'next/link';

/** Links every public page carries. Google checks that the home page links to the privacy policy. */
export function SiteFooter({ className = '' }: { className?: string }) {
  return (
    <footer className={`flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted ${className}`}>
      <Link href="/privacy" className="hover:text-ink hover:underline">Privacy policy</Link>
      <Link href="/terms" className="hover:text-ink hover:underline">Terms of service</Link>
    </footer>
  );
}
