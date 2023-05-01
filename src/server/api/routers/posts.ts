import clerkClient from "@clerk/clerk-sdk-node";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, privateProcedure, publicProcedure } from "~/server/api/trpc";
import { Ratelimit } from "@upstash/ratelimit"; // for deno: see above
import { Redis } from "@upstash/redis";
import dayjs from "dayjs";

// Create a new ratelimiter, that allows 3 requests per 1 minute
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(3, "1 m"),
  analytics: true,
  /**
   * Optional prefix for the keys used in redis. This is useful if you want to share a redis
   * instance with other applications and want to avoid key collisions. The default prefix is
   * "@upstash/ratelimit"
   */
  prefix: "@upstash/ratelimit",
});

export const postsRouter = createTRPCRouter({
  // Returns a list of all osts with author information
  getAll: publicProcedure.query(async ({ ctx }) => {
    const posts = await ctx.prisma.post.findMany({
      take: 100,
      orderBy: {
        createdAt: "desc",
      },
    });

    const users = await clerkClient.users.getUserList({
      userId: posts.map((post) => post.authorId),
      limit: 100,
    });

    const userDict = users.reduce<Record<string, { id: string, userName?: string, eMail?: string, profileImageUrl: string }>>((acc, user) => {
      acc[user.id] = {
        id: user.id,
        userName: user.username ?? undefined,
        eMail: user.emailAddresses[0]?.emailAddress ?? undefined,
        profileImageUrl: user.profileImageUrl,
      };
      return acc;
    }, {});

    const postsWithAuthor = posts.map((post) => {
      const author = userDict[post.authorId];

      if (!author) throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Author not found for post ${post.id}`,
      });

      return {
        post,
        author,
      };
    });

    return postsWithAuthor;
  }),
  create: privateProcedure.input(z.object({
    content: z.string().min(1).max(255).nonempty(),
  })).mutation(async ({ ctx, input }) => {
    const authorId = ctx.currentUserId;

    const { success, reset } = await ratelimit.limit(authorId);

    if (!success) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `You have exceeded the rate limit for this action. Try again after ${dayjs(reset).format()}.`,
      });
    }

    await ctx.prisma.post.create({
      data: {
        authorId,
        content: input.content,
      },
    });
  }),
});
