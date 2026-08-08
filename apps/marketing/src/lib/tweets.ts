export type Tweet = {
  handle: string;
  content: string;
  excerpt?: string;
  link: string;
};

// Upstream testimonial quotes mention the original product by name. Do not
// rewrite third-party quotes into Fenix endorsements; add Fenix-owned quotes here
// when they exist.
export const tweets: Tweet[] = [];
