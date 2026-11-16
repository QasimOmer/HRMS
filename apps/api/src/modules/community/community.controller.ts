import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  PERMISSIONS as P,
  announcementSchema,
  commentSchema,
  communitySettingsSchema,
  grantPostingSchema,
  guidelinesSchema,
  moderationRemovalSchema,
  postSchema,
  COMMUNITY_WARNINGS_BEFORE_ACTION,
} from '@hrms/shared';
import { and, asc, desc, eq, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { als, currentUser, type AuthUser } from '../../common/context';
import { Audit, RequireAny, RequireModule } from '../../common/decorators';
import { badRequest, forbidden } from '../../common/errors';
import { addDays, todayIn } from '../../common/tz';
import { one, tenantInfo } from '../../common/util';
import { zp } from '../../common/zod.pipe';
import { NotificationsService } from '../../core/notifications.service';
import { DbService } from '../../db/db.service';
import {
  communityViolations,
  departments,
  employees,
  guidelineAcceptances,
  guidelineVersions,
  postComments,
  postLikes,
  posts,
  tenants,
  users,
} from '../../db/schema';

const feedQuery = z.object({
  departmentId: z.uuid().optional(),
  type: z.enum(['POST', 'ANNOUNCEMENT', 'BIRTHDAY']).optional(),
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

@RequireModule('COMMUNITY')
@Controller()
export class CommunityController {
  constructor(
    private readonly db: DbService,
    private readonly notify: NotificationsService,
  ) {}

  /* ---------------- F2 Community guidelines ---------------- */

  private async latestGuidelines() {
    const [g] = await this.db.tx.select().from(guidelineVersions).orderBy(desc(guidelineVersions.version)).limit(1);
    return g;
  }

  /** Feed access requires acceptance of the latest guidelines (F2, G1). */
  private async assertAccepted() {
    const g = await this.latestGuidelines();
    if (!g) return;
    const [a] = await this.db.tx
      .select()
      .from(guidelineAcceptances)
      .where(and(eq(guidelineAcceptances.userId, currentUser().userId), eq(guidelineAcceptances.version, g.version)));
    if (!a) throw forbidden('Please accept the Community Guidelines to continue');
  }

  @Get('community/guidelines')
  async guidelines() {
    const g = await this.latestGuidelines();
    const [a] = g
      ? await this.db.tx.select().from(guidelineAcceptances).where(and(eq(guidelineAcceptances.userId, currentUser().userId), eq(guidelineAcceptances.version, g.version)))
      : [];
    return { version: g?.version ?? 0, content: g?.content ?? '', publishedAt: g?.createdAt ?? null, acceptedAt: a?.acceptedAt ?? null };
  }

  @Post('community/guidelines/accept')
  @Audit('community.guidelines_accepted', 'guidelines')
  async accept() {
    const g = await this.latestGuidelines();
    if (!g) throw badRequest('No guidelines published');
    const u = currentUser();
    await this.db.tx
      .insert(guidelineAcceptances)
      .values({ tenantId: u.tenantId, userId: u.userId, version: g.version, email: u.email, ip: als.getStore()?.ip })
      .onConflictDoNothing();
    return { version: g.version, accepted: true };
  }

  /** Publishing a new version requires everyone to accept again. */
  @Put('community/guidelines')
  @RequireAny(P.GUIDELINES_MANAGE)
  @Audit('community.guidelines_published', 'guidelines')
  async publishGuidelines(@Body(zp(guidelinesSchema)) body: z.infer<typeof guidelinesSchema>) {
    const g = await this.latestGuidelines();
    const u = currentUser();
    const row = one(await this.db.tx.insert(guidelineVersions).values({ tenantId: u.tenantId, version: (g?.version ?? 0) + 1, content: body.content, publishedByUserId: u.userId }).returning());
    return { version: row.version };
  }

  @Get('community/guidelines/acceptances')
  @RequireAny(P.GUIDELINES_MANAGE)
  async acceptances() {
    const g = await this.latestGuidelines();
    if (!g) return { version: 0, items: [] };
    const items = await this.db.tx
      .select({ email: guidelineAcceptances.email, acceptedAt: guidelineAcceptances.acceptedAt, fullName: employees.fullName })
      .from(guidelineAcceptances)
      .innerJoin(users, eq(users.id, guidelineAcceptances.userId))
      .leftJoin(employees, eq(employees.id, users.employeeId))
      .where(eq(guidelineAcceptances.version, g.version))
      .orderBy(desc(guidelineAcceptances.acceptedAt));
    return { version: g.version, items };
  }

  /* ---------------- G1 Feed ---------------- */

  private isStaff(u: AuthUser) {
    return u.permissions.has(P.ANNOUNCEMENTS_PUBLISH) || u.permissions.has(P.COMMUNITY_MODERATE);
  }

  private async canPost(u: AuthUser) {
    if (this.isStaff(u)) return true;
    const t = await tenantInfo(this.db.tx);
    if (t.settings.communityPostingMode === 'EVERYONE') return true;
    if (t.settings.communityPostingMode === 'GRANTED_ONLY') return u.canPost;
    return false;
  }

  @Get('community/settings')
  async settings() {
    const t = await tenantInfo(this.db.tx);
    const u = currentUser();
    return { postingMode: t.settings.communityPostingMode, engagementEnabled: t.settings.communityEngagementEnabled, canPost: await this.canPost(u) };
  }

  @Patch('community/settings')
  @RequireAny(P.COMMUNITY_POSTING_MANAGE)
  @Audit('community.settings_updated', 'tenant')
  async updateSettings(@Body(zp(communitySettingsSchema)) body: z.infer<typeof communitySettingsSchema>) {
    const t = await tenantInfo(this.db.tx);
    await this.db.tx
      .update(tenants)
      .set({ settings: { ...t.settings, communityPostingMode: body.postingMode, communityEngagementEnabled: body.engagementEnabled } })
      .where(eq(tenants.id, t.id));
    return body;
  }

  /** HR grants posting access to specific employees (G1). */
  @Put('community/posting/:userId')
  @RequireAny(P.COMMUNITY_POSTING_MANAGE)
  @Audit('community.posting_granted', 'user')
  async grant(@Param('userId', ParseUUIDPipe) userId: string, @Body(zp(grantPostingSchema)) body: z.infer<typeof grantPostingSchema>) {
    one(await this.db.tx.update(users).set({ canPost: body.canPost }).where(eq(users.id, userId)).returning({ id: users.id }), 'User');
    return { userId, canPost: body.canPost };
  }

  @Get('community/feed')
  async feed(@Query(zp(feedQuery)) q: z.infer<typeof feedQuery>) {
    await this.assertAccepted();
    const u = currentUser();
    const tx = this.db.tx;
    const [me] = u.employeeId ? await tx.select({ dept: employees.departmentId }).from(employees).where(eq(employees.id, u.employeeId)) : [];
    const conds: SQL[] = [isNull(posts.deletedAt)];
    // Department-wise updates are visible to that department (and moderators).
    if (!u.permissions.has(P.COMMUNITY_MODERATE)) conds.push(or(isNull(posts.departmentId), me ? eq(posts.departmentId, me.dept) : sql`false`)!);
    if (q.departmentId) conds.push(eq(posts.departmentId, q.departmentId));
    if (q.type) conds.push(eq(posts.type, q.type));
    if (q.before) conds.push(lt(posts.createdAt, new Date(q.before)));
    const author = sql<string | null>`(select e.full_name from users uu join employees e on e.id = uu.employee_id where uu.id = ${posts.authorUserId})`;
    const authorAvatar = sql<string | null>`(select e.avatar_file_id from users uu join employees e on e.id = uu.employee_id where uu.id = ${posts.authorUserId})`;
    const authorTitle = sql<string | null>`(select e.designation from users uu join employees e on e.id = uu.employee_id where uu.id = ${posts.authorUserId})`;
    const subjectAvatar = sql<string | null>`(select avatar_file_id from employees e where e.id = ${posts.subjectEmployeeId})`;
    const rows = await tx
      .select({
        p: posts,
        departmentName: departments.name,
        authorName: author,
        authorAvatarFileId: authorAvatar,
        authorDesignation: authorTitle,
        subjectAvatarFileId: subjectAvatar,
        likes: sql<number>`(select count(*)::int from post_likes l where l.post_id = ${posts.id})`,
        comments: sql<number>`(select count(*)::int from post_comments c where c.post_id = ${posts.id} and c.deleted_at is null)`,
        liked: sql<boolean>`exists(select 1 from post_likes l where l.post_id = ${posts.id} and l.user_id = ${u.userId})`,
      })
      .from(posts)
      .leftJoin(departments, eq(departments.id, posts.departmentId))
      .where(and(...conds))
      .orderBy(desc(posts.pinned), desc(posts.createdAt))
      .limit(q.limit);
    return rows.map((r) => ({
      ...r.p,
      departmentName: r.departmentName,
      authorName: r.authorName,
      authorAvatarFileId: r.authorAvatarFileId,
      authorDesignation: r.authorDesignation,
      subjectAvatarFileId: r.subjectAvatarFileId,
      likes: r.likes,
      comments: r.comments,
      liked: r.liked,
      canDelete: r.p.authorUserId === u.userId || u.permissions.has(P.COMMUNITY_MODERATE),
      mine: r.p.authorUserId === u.userId,
      system: !r.p.authorUserId,
    }));
  }

  @Post('community/posts')
  @Audit('community.post_created', 'post')
  async createPost(@Body(zp(postSchema)) body: z.infer<typeof postSchema>) {
    await this.assertAccepted();
    const u = currentUser();
    if (!(await this.canPost(u))) throw forbidden('Posting is not enabled for your account');
    return one(await this.db.tx.insert(posts).values({ tenantId: u.tenantId, authorUserId: u.userId, type: 'POST', body: body.body, departmentId: body.departmentId ?? null }).returning());
  }

  /** Authors delete their own posts. Removing someone else's post goes through `remove` (with a reason). */
  @Delete('community/posts/:id')
  @Audit('community.post_deleted', 'post')
  async deletePost(@Param('id', ParseUUIDPipe) id: string) {
    const u = currentUser();
    const p = one(await this.db.tx.select().from(posts).where(eq(posts.id, id)), 'Post');
    if (p.authorUserId !== u.userId) {
      if (!u.permissions.has(P.COMMUNITY_MODERATE)) throw forbidden();
      // System posts (birthdays) have no author to warn; anything else needs a reason.
      if (p.authorUserId) throw badRequest("Give a reason when removing someone else's post", 'REASON_REQUIRED');
    }
    await this.db.tx.update(posts).set({ deletedAt: new Date(), deletedByUserId: u.userId }).where(eq(posts.id, id));
    return { id, deleted: true };
  }

  /** F2: a moderator (HR, or a Team Lead given moderation) removes a post that breaks the guidelines. */
  @Post('community/posts/:id/remove')
  @RequireAny(P.COMMUNITY_MODERATE)
  @Audit('community.post_removed', 'post')
  async removePost(@Param('id', ParseUUIDPipe) id: string, @Body(zp(moderationRemovalSchema)) body: z.infer<typeof moderationRemovalSchema>) {
    const u = currentUser();
    const p = one(await this.db.tx.select().from(posts).where(and(eq(posts.id, id), isNull(posts.deletedAt))), 'Post');
    await this.db.tx.update(posts).set({ deletedAt: new Date(), deletedByUserId: u.userId }).where(eq(posts.id, id));
    const violation = p.authorUserId && p.authorUserId !== u.userId
      ? await this.recordViolation(p.authorUserId, { postId: id }, body.reason, `${p.title ? `${p.title}: ` : ''}${p.body}`, 'post')
      : null;
    return { id, deleted: true, violation };
  }

  @Post('community/comments/:id/remove')
  @RequireAny(P.COMMUNITY_MODERATE)
  @Audit('community.comment_removed', 'post_comment')
  async removeComment(@Param('id', ParseUUIDPipe) id: string, @Body(zp(moderationRemovalSchema)) body: z.infer<typeof moderationRemovalSchema>) {
    const u = currentUser();
    const c = one(await this.db.tx.select().from(postComments).where(and(eq(postComments.id, id), isNull(postComments.deletedAt))), 'Comment');
    await this.db.tx.update(postComments).set({ deletedAt: new Date() }).where(eq(postComments.id, id));
    const violation = c.userId !== u.userId ? await this.recordViolation(c.userId, { commentId: id }, body.reason, c.body, 'comment') : null;
    return { id, deleted: true, violation };
  }

  /**
   * Records the breach and tells the author why. 1st and 2nd (within 12 months) are warnings;
   * the 3rd becomes a disciplinary case: the author is told and HR is alerted to follow up.
   */
  private async recordViolation(userId: string, ref: { postId?: string; commentId?: string }, reason: string, excerpt: string, what: 'post' | 'comment') {
    const u = currentUser();
    const since = new Date(Date.now() - 365 * 864e5);
    const [{ n }] = (await this.db.tx.select({ n: sql<number>`count(*)::int` }).from(communityViolations)
      .where(and(eq(communityViolations.userId, userId), sql`${communityViolations.createdAt} >= ${since}`))) as [{ n: number }];
    const level = n + 1;
    await this.db.tx.insert(communityViolations).values({ tenantId: u.tenantId, userId, ...ref, reason, level, removedByUserId: u.userId, contentExcerpt: excerpt.slice(0, 300) });
    const max = COMMUNITY_WARNINGS_BEFORE_ACTION;
    if (level <= max) {
      await this.notify.notifyUsers([userId], {
        type: 'community.warning',
        title: `Warning ${level} of ${max}: your ${what} was removed`,
        body: `Reason: ${reason}. ${level === max ? 'This is your final warning. One more breach of the Community Guidelines leads to disciplinary action.' : `After ${max} warnings, the next breach leads to disciplinary action.`}`,
        link: '/community/guidelines',
        email: true,
      });
    } else {
      const [who] = await this.db.tx.select({ name: employees.fullName, email: users.email }).from(users).leftJoin(employees, eq(employees.id, users.employeeId)).where(eq(users.id, userId));
      await this.notify.notifyUsers([userId], {
        type: 'community.disciplinary',
        title: `Disciplinary action: your ${what} was removed again`,
        body: `Reason: ${reason}. You have broken the Community Guidelines ${level} times in 12 months after ${max} warnings, so HR will follow up with disciplinary action.`,
        link: '/community/guidelines',
        email: true,
      });
      await this.notify.notifyPermission(P.EMPLOYEES_MANAGE, {
        type: 'community.disciplinary_case',
        title: `${who?.name ?? who?.email ?? 'An employee'} needs disciplinary action (${level} community violations)`,
        body: `Latest: ${reason}`,
        link: '/community/moderation',
        email: true,
      });
    }
    return { level, warning: level <= max, disciplinary: level > max };
  }

  /** Moderation log for HR and moderators. */
  @Get('community/violations')
  @RequireAny(P.COMMUNITY_MODERATE, P.EMPLOYEES_MANAGE)
  async violations() {
    const remover = alias(users, 'remover');
    const removerEmp = alias(employees, 'remover_emp');
    const rows = await this.db.tx
      .select({ v: communityViolations, name: employees.fullName, email: users.email, removedBy: removerEmp.fullName })
      .from(communityViolations)
      .innerJoin(users, eq(users.id, communityViolations.userId))
      .leftJoin(employees, eq(employees.id, users.employeeId))
      .leftJoin(remover, eq(remover.id, communityViolations.removedByUserId))
      .leftJoin(removerEmp, eq(removerEmp.id, remover.employeeId))
      .orderBy(desc(communityViolations.createdAt))
      .limit(300);
    return rows.map((r) => ({ ...r.v, name: r.name ?? r.email, removedBy: r.removedBy, disciplinary: r.v.level > COMMUNITY_WARNINGS_BEFORE_ACTION }));
  }

  /** The signed-in person's own standing (shown on the guidelines page). */
  @Get('community/my-standing')
  async myStanding() {
    const since = new Date(Date.now() - 365 * 864e5);
    const rows = await this.db.tx.select({ reason: communityViolations.reason, level: communityViolations.level, createdAt: communityViolations.createdAt })
      .from(communityViolations)
      .where(and(eq(communityViolations.userId, currentUser().userId), sql`${communityViolations.createdAt} >= ${since}`))
      .orderBy(desc(communityViolations.createdAt));
    return { count: rows.length, warningsAllowed: COMMUNITY_WARNINGS_BEFORE_ACTION, items: rows };
  }

  private async assertEngagement() {
    await this.assertAccepted();
    const t = await tenantInfo(this.db.tx);
    if (!t.settings.communityEngagementEnabled) throw forbidden('Likes and comments are turned off');
  }

  @Post('community/posts/:id/like')
  @Audit('community.post_liked', 'post')
  async like(@Param('id', ParseUUIDPipe) id: string) {
    await this.assertEngagement();
    const u = currentUser();
    const tx = this.db.tx;
    const [existing] = await tx.select().from(postLikes).where(and(eq(postLikes.postId, id), eq(postLikes.userId, u.userId)));
    if (existing) {
      await tx.delete(postLikes).where(and(eq(postLikes.postId, id), eq(postLikes.userId, u.userId)));
      return { liked: false };
    }
    await tx.insert(postLikes).values({ tenantId: u.tenantId, postId: id, userId: u.userId });
    return { liked: true };
  }

  @Get('community/posts/:id/comments')
  async comments(@Param('id', ParseUUIDPipe) id: string) {
    await this.assertAccepted();
    const u = currentUser();
    const rows = await this.db.tx
      .select({ c: postComments, fullName: employees.fullName, avatarFileId: employees.avatarFileId })
      .from(postComments)
      .innerJoin(users, eq(users.id, postComments.userId))
      .leftJoin(employees, eq(employees.id, users.employeeId))
      .where(and(eq(postComments.postId, id), isNull(postComments.deletedAt)))
      .orderBy(asc(postComments.createdAt));
    return rows.map((r) => ({ ...r.c, fullName: r.fullName, avatarFileId: r.avatarFileId, canDelete: r.c.userId === u.userId || u.permissions.has(P.COMMUNITY_MODERATE), mine: r.c.userId === u.userId }));
  }

  @Post('community/posts/:id/comments')
  @Audit('community.comment_created', 'post')
  async comment(@Param('id', ParseUUIDPipe) id: string, @Body(zp(commentSchema)) body: z.infer<typeof commentSchema>) {
    await this.assertEngagement();
    const u = currentUser();
    const p = one(await this.db.tx.select().from(posts).where(and(eq(posts.id, id), isNull(posts.deletedAt))), 'Post');
    const row = one(await this.db.tx.insert(postComments).values({ tenantId: u.tenantId, postId: id, userId: u.userId, body: body.body }).returning());
    if (p.authorUserId && p.authorUserId !== u.userId) await this.notify.notifyUsers([p.authorUserId], { type: 'community.comment', title: 'New comment on your post', link: '/community' });
    return row;
  }

  @Delete('community/comments/:id')
  @Audit('community.comment_deleted', 'post_comment')
  async deleteComment(@Param('id', ParseUUIDPipe) id: string) {
    const u = currentUser();
    const c = one(await this.db.tx.select().from(postComments).where(eq(postComments.id, id)), 'Comment');
    if (c.userId !== u.userId) {
      if (!u.permissions.has(P.COMMUNITY_MODERATE)) throw forbidden();
      throw badRequest("Give a reason when removing someone else's comment", 'REASON_REQUIRED');
    }
    await this.db.tx.update(postComments).set({ deletedAt: new Date() }).where(eq(postComments.id, id));
    return { id, deleted: true };
  }

  /* ---------------- G2 Announcements ---------------- */

  /** Shown on dashboards regardless of guideline acceptance. */
  @Get('announcements')
  async announcements(@Query(zp(z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) }))) q: { limit: number }) {
    const u = currentUser();
    const [me] = u.employeeId ? await this.db.tx.select({ dept: employees.departmentId }).from(employees).where(eq(employees.id, u.employeeId)) : [];
    return this.db.tx
      .select({ id: posts.id, title: posts.title, body: posts.body, pinned: posts.pinned, createdAt: posts.createdAt, departmentId: posts.departmentId, departmentName: departments.name })
      .from(posts)
      .leftJoin(departments, eq(departments.id, posts.departmentId))
      .where(and(eq(posts.type, 'ANNOUNCEMENT'), isNull(posts.deletedAt), or(isNull(posts.departmentId), me ? eq(posts.departmentId, me.dept) : sql`false`)))
      .orderBy(desc(posts.pinned), desc(posts.createdAt))
      .limit(q.limit);
  }

  @Post('announcements')
  @RequireAny(P.ANNOUNCEMENTS_PUBLISH)
  @Audit('announcement.published', 'post')
  async announce(@Body(zp(announcementSchema)) body: z.infer<typeof announcementSchema>) {
    const u = currentUser();
    const row = one(
      await this.db.tx
        .insert(posts)
        .values({ tenantId: u.tenantId, authorUserId: u.userId, type: 'ANNOUNCEMENT', title: body.title, body: body.body, departmentId: body.departmentId ?? null, pinned: body.pinned })
        .returning(),
    );
    const audience = body.departmentId
      ? await this.db.tx.select({ id: users.id }).from(users).innerJoin(employees, eq(employees.id, users.employeeId)).where(and(eq(users.status, 'ACTIVE'), eq(employees.departmentId, body.departmentId)))
      : await this.db.tx.select({ id: users.id }).from(users).where(eq(users.status, 'ACTIVE'));
    await this.notify.notifyUsers(audience.map((a) => a.id).filter((id) => id !== u.userId), { type: 'announcement', title: `Announcement: ${body.title}`, link: '/announcements' });
    return row;
  }

  @Patch('announcements/:id/pin')
  @RequireAny(P.ANNOUNCEMENTS_PUBLISH)
  @Audit('announcement.pinned', 'post')
  async pin(@Param('id', ParseUUIDPipe) id: string, @Body(zp(z.object({ pinned: z.boolean() }))) body: { pinned: boolean }) {
    await this.db.tx.update(posts).set({ pinned: body.pinned }).where(eq(posts.id, id));
    return { id, pinned: body.pinned };
  }

  /* ---------------- G3 Birthdays ---------------- */

  @Get('birthdays')
  async birthdays() {
    const t = await tenantInfo(this.db.tx);
    const today = todayIn(t.timezone);
    const rows = await this.db.tx
      .select({ id: employees.id, fullName: employees.fullName, avatarFileId: employees.avatarFileId, designation: employees.designation, departmentName: departments.name, dateOfBirth: employees.dateOfBirth })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .where(and(eq(employees.employmentStatus, 'ACTIVE'), sql`${employees.dateOfBirth} is not null`));
    const md = (d: string) => d.slice(5);
    const window = new Set(Array.from({ length: 31 }, (_, i) => md(addDays(today, i))));
    return rows
      .filter((r) => window.has(md(r.dateOfBirth!)))
      .map(({ dateOfBirth, ...r }) => {
        const mmdd = md(dateOfBirth!);
        let next = `${today.slice(0, 4)}-${mmdd}`;
        if (next < today) next = `${Number(today.slice(0, 4)) + 1}-${mmdd}`;
        return { ...r, date: next, isToday: mmdd === md(today) }; // birth year never exposed
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}
