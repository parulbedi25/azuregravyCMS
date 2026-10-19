export type Role = 'admin' | 'editor' | 'author';
export type PostType = 'post' | 'page';
export type PostStatus = 'draft' | 'published' | 'scheduled' | 'private' | 'trash';
export type CommentStatus = 'pending' | 'approved' | 'spam' | 'trash';

export interface User {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  bio: string | null;
  avatar: string | null;
  website: string | null;
  twitter: string | null;
  linkedin: string | null;
  created_at: string;
  last_login_at: string | null;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  parent_id: number | null;
  image: string | null;
  color: string;
  sort_order: number;
  created_at: string;
  post_count?: number;
}

export interface Tag {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  created_at: string;
  post_count?: number;
}

export interface Media {
  id: number;
  filename: string;
  path: string;
  original_name: string;
  mime_type: string;
  size: number;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  caption: string | null;
  title: string | null;
  uploaded_by: number | null;
  created_at: string;
}

export interface Post {
  id: number;
  type: PostType;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  content_html: string | null;
  featured_image_id: number | null;
  og_image_id: number | null;
  status: PostStatus;
  author_id: number;
  parent_id: number | null;
  template: string;
  is_sticky: number;
  allow_comments: number;
  views: number;
  reading_time: number;
  seo_title: string | null;
  seo_description: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  // joined
  featured_image?: string | null;
  author_name?: string;
  author_avatar?: string | null;
  author_bio?: string | null;
  category_names?: string | null;
  category_slugs?: string | null;
  category_name?: string | null;
  category_slug?: string | null;
  category_color?: string | null;
  category_colors?: string | null;
  comment_count?: number;
  tag_names?: string | null;
  tags?: Tag[];
  categories?: Category[];
}

export interface Comment {
  id: number;
  post_id: number;
  parent_id: number | null;
  author_name: string;
  author_email: string | null;
  author_url: string | null;
  content: string;
  status: CommentStatus;
  user_id: number | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  post_title?: string;
  post_slug?: string;
  avatar_seed?: string;
}

export interface Revision {
  id: number;
  post_id: number;
  title: string;
  content: string;
  excerpt: string | null;
  author_id: number | null;
  author_name?: string;
  created_at: string;
}

export interface Subscriber {
  id: number;
  email: string;
  name: string | null;
  status: 'pending' | 'confirmed' | 'unsubscribed';
  token: string;
  created_at: string;
}

export interface Redirect {
  id: number;
  from_path: string;
  to_path: string;
  status_code: number;
  hits: number;
  created_at: string;
}

export interface ActivityEntry {
  id: number;
  user_id: number | null;
  user_name?: string | null;
  action: string;
  subject: string | null;
  meta: string | null;
  created_at: string;
}

export interface MenuItem {
  id: number;
  location: 'primary' | 'footer' | 'legal';
  label: string;
  url: string;
  parent_id: number | null;
  sort_order: number;
  is_active: number;
  target: '_self' | '_blank';
}

export type SettingsMap = Record<string, string>;

export interface CurrentUser extends User {
  sessionId?: string;
}
