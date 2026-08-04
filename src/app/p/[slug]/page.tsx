import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { RichText } from "@/components/rich-text";

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

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="mb-6 text-3xl font-bold">{page.title}</h1>
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
