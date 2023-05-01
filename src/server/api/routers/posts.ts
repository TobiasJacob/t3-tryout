import clerkClient from "@clerk/clerk-sdk-node";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, privateProcedure, publicProcedure } from "~/server/api/trpc";


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

    const post = await ctx.prisma.post.create({
      data: {
        authorId,
        content: input.content,
      },
    });
  }),
});
