import Image from "next/image";
import Link from "next/link";
import { ShareButton } from "@/components/share-button";
import { Pill } from "@/components/ui/pill";
import { eventDay, type EventListItem } from "@/lib/events";
import { publicEnv } from "@/lib/env";

/** Cartão de evento com foto à direita (design §4b). */
export function EventCard({ event, photo }: { event: EventListItem; photo: string }) {
  const when = eventDay(event.starts_at);
  return (
    <article className="relative overflow-hidden rounded-md border border-line bg-surface">
      <div className="absolute inset-y-0 right-0 w-[62%]">
        {event.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.cover_url} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
        ) : (
          <Image src={photo} alt="" fill sizes="(max-width: 448px) 62vw, 280px" className="object-cover" />
        )}
      </div>
      <span aria-hidden className="absolute inset-0 bg-[linear-gradient(90deg,var(--color-surface)_38%,color-mix(in_srgb,var(--color-surface)_30%,transparent))]" />
      <div className="relative flex items-center gap-3 p-3">
        <div className="grid min-w-14 place-items-center rounded-sm bg-surface-2 px-2 py-1.5 text-center">
          {when ? (
            <>
              <span className="font-display text-xl font-bold leading-none">{when.day}</span>
              <span className="text-[10px] font-extrabold text-muted">{when.month}</span>
            </>
          ) : (
            <span className="font-display text-sm font-bold">#{event.number}</span>
          )}
        </div>
        <Link href={`/sala/${event.id}`} className="min-w-0 flex-1">
          <p className="font-bold leading-tight">
            Leilão #{event.number} · {event.title}
          </p>
          <p className="text-xs text-muted">
            {[when?.time, `${event.round_count} cartas`].filter(Boolean).join(" · ")}
          </p>
        </Link>
        {event.status === "live" ? (
          <Pill tone="live" dot>
            Ao vivo
          </Pill>
        ) : event.status === "scheduled" ? (
          <ShareButton url={`${publicEnv.siteUrl}/e/${event.share_slug}`} title={`Leilão #${event.number} · ${event.title}`} />
        ) : (
          <Pill>{event.status === "finished" ? "Encerrado" : "Cancelado"}</Pill>
        )}
      </div>
    </article>
  );
}
