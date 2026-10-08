// next/link outside Next (node test bundles): the <a> it renders, with every
// prop passed through, so markup assertions can read href and data-*.
type Props = { href: string; children?: React.ReactNode } & Record<string, unknown>;
export default function Link({ href, children, ...rest }: Props) {
  return <a href={href} {...rest}>{children}</a>;
}
