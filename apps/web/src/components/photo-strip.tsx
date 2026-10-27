'use client';

/** The farmer's photos of the animal (§24.15): small thumbnails that open full size. */
export function PhotoStrip({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <ul className="flex gap-2">
      {urls.map((u, i) => (
        <li key={u}>
          <a href={u} target="_blank" rel="noopener noreferrer">
            {/* Signed, short-lived links: not optimisable by next/image. */}
            <img
              src={u}
              alt={`📷 ${i + 1}`}
              width={72}
              height={72}
              loading="lazy"
              className="size-18 rounded-control object-cover"
            />
          </a>
        </li>
      ))}
    </ul>
  );
}
