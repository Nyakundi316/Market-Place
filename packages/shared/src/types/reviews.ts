export interface ReviewDto {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  rater: { username: string; displayName: string; avatarUrl: string | null };
  listing: { title: string; slug: string } | null;
}
