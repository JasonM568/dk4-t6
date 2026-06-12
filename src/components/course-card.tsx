import Link from "next/link";
import { formatNT } from "@/lib/format";

type CourseCardProps = {
  course: {
    slug: string;
    title: string;
    description: string;
    coverImage: string | null;
    listPrice: number | null;
    price: number;
  };
};

export function CourseCard({ course }: CourseCardProps) {
  return (
    <Link
      href={`/courses/${course.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-gray-200 transition hover:shadow-lg"
    >
      <div className="aspect-video overflow-hidden bg-gray-100">
        {course.coverImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={course.coverImage}
            alt={course.title}
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="font-bold">{course.title}</h3>
        <p className="mt-1 line-clamp-2 flex-1 text-sm text-gray-500">
          {course.description}
        </p>
        <div className="mt-3 flex items-baseline gap-2">
          {course.listPrice != null && course.listPrice > course.price && (
            <span className="text-sm text-gray-400 line-through">
              {formatNT(course.listPrice)}
            </span>
          )}
          <span className="text-lg font-bold text-indigo-600">
            {formatNT(course.price)}
          </span>
        </div>
      </div>
    </Link>
  );
}
