// next/image outside Next (node test bundles): the props a real <Image> gets,
// rendered as the plain <img> it becomes, so markup assertions can read them.
type Props = {
  src: string; alt: string; width?: number; height?: number; sizes?: string;
  priority?: boolean; loading?: "lazy" | "eager"; className?: string;
  fill?: boolean; style?: React.CSSProperties;
};
export default function Image({ src, alt, width, height, sizes, priority, loading, className, fill, style }: Props) {
  return (
    <img src={src} alt={alt} width={width} height={height} sizes={sizes}
      loading={priority ? "eager" : loading} className={className} style={style}
      data-next-image="" data-fill={fill ? "" : undefined} />
  );
}
