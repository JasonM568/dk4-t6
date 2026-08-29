import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { RichText } from "@/components/rich-text";
import { youTubeEmbedUrl } from "@/lib/video-embed";
import { VideoViewTracker } from "./video-view-tracker";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await prisma.customPage.findUnique({
    where: { slug },
    select: { title: true, isPublished: true },
  });
  return { title: page?.isPublished ? page.title : "頁面" };
}

export default async function CustomPageView({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await prisma.customPage.findUnique({ where: { slug } });
  if (!page || !page.isPublished) notFound();

  const embed = page.videoUrl ? youTubeEmbedUrl(page.videoUrl) : null;
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="mb-6 text-3xl font-bold">{page.title}</h1>
      {/* 短影片行銷頁：影片在內文上方；看過的人由 VideoViewTracker 發 ViewContent 供廣告圈受眾 */}
      {page.videoUrl && (
        <>
          <VideoViewTracker slug={page.slug} title={page.title} />
          {embed ? (
            <div className="mb-8 aspect-video overflow-hidden rounded-2xl bg-black">
              <iframe
                src={embed}
                title={page.title}
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          ) : (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video src={page.videoUrl} controls playsInline className="mb-8 w-full rounded-2xl bg-black" />
          )}
        </>
      )}
      {page.content && <RichText text={page.content} />}
      {page.images.length > 0 && (
        <div className="mt-8 space-y-6">
          {page.images.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={src}
              src={src}
              alt={page.title}
              className="w-full rounded-2xl"
            />
          ))}
        </div>
      )}
    </main>
  );
}
