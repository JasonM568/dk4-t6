import { Prisma } from "@prisma/client";
import { nextOrderNo } from "@/lib/order-no";

export const ORDER_NO_MAX_ATTEMPTS = 8;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function createOrderWithRetry<T>(
  course: { courseCode?: string | null; slug?: string | null },
  build: (orderNo: string) => Promise<T>,
  opts?: { generate?: (attempt: number) => string | Promise<string> },
): Promise<{ ok: true; value: T; orderNo: string } | { ok: false }> {
  for (let attempt = 0; attempt < ORDER_NO_MAX_ATTEMPTS; attempt++) {
    const orderNo = await (opts?.generate ? opts.generate(attempt) : nextOrderNo(course, attempt));
    try {
      const value = await build(orderNo);
      return { ok: true, value, orderNo };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const target = String((e.meta as { target?: unknown } | undefined)?.target ?? "");
        if (target.includes("orderNo")) {
          await sleep(20 + Math.random() * 60);
          continue;
        }
      }
      throw e;
    }
  }
  return { ok: false };
}
