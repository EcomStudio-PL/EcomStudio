"use client";
import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * MEDIA — an image inside a frame that already knows its shape.
 *
 * The frame claims its aspect ratio before the picture exists, so a card
 * never grows when the image arrives; a shimmer fills the gap and the photo
 * fades in over it. Cards that jumped as thumbnails loaded — and the blank
 * grey rectangles in the category grid — were both this missing.
 */
export function Media({ src, alt = "", ratio = "4/3", className, rounded = "rounded-xl", eager }: {
  src?: string | null;
  alt?: string;
  /** Any CSS aspect-ratio value: "4/3", "1/1", "16/9". */
  ratio?: string;
  className?: string;
  rounded?: string;
  /** Above-the-fold images skip lazy loading. */
  eager?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <span className={cn("media-frame block", rounded, className)} style={{ aspectRatio: ratio }}>
      {src ? (
        <>
          {!loaded && <span aria-hidden className="media-skeleton" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            data-loaded={loaded ? "true" : "false"}
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
          />
        </>
      ) : (
        <span aria-hidden className="absolute inset-0 flex items-center justify-center text-faint">
          <ImageIcon size={18} className="opacity-45" />
        </span>
      )}
    </span>
  );
}
