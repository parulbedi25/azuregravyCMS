/**
 * One canonical MariaDB schema. It is applied to whichever driver is active:
 *   - `embedded` → real MariaDB 13 compiled to WebAssembly (lite4mariadb)
 *   - `mysql`    → a MariaDB/MySQL server over the wire (mysql2)
 *
 * Everything is InnoDB + utf8mb4 so foreign keys, transactions and emoji all work.
 */
export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    version INT UNSIGNED NOT NULL PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(190) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin','editor','author') NOT NULL DEFAULT 'author',
    bio TEXT NULL,
    avatar VARCHAR(255) NULL,
    website VARCHAR(255) NULL,
    twitter VARCHAR(120) NULL,
    linkedin VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS settings (
    setting_key VARCHAR(120) NOT NULL PRIMARY KEY,
    setting_value LONGTEXT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS categories (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    slug VARCHAR(140) NOT NULL UNIQUE,
    description TEXT NULL,
    parent_id BIGINT UNSIGNED NULL,
    image VARCHAR(255) NULL,
    color VARCHAR(24) NOT NULL DEFAULT '#2f5bd7',
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_categories_parent FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS tags (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    slug VARCHAR(140) NOT NULL UNIQUE,
    description TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS media (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    path VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(120) NOT NULL,
    size INT UNSIGNED NOT NULL DEFAULT 0,
    width INT UNSIGNED NULL,
    height INT UNSIGNED NULL,
    alt_text VARCHAR(255) NULL,
    caption VARCHAR(500) NULL,
    title VARCHAR(255) NULL,
    uploaded_by BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_media_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS posts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    type ENUM('post','page') NOT NULL DEFAULT 'post',
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    excerpt TEXT NULL,
    content MEDIUMTEXT NOT NULL,
    content_html MEDIUMTEXT NULL,
    featured_image_id BIGINT UNSIGNED NULL,
    og_image_id BIGINT UNSIGNED NULL,
    status ENUM('draft','published','scheduled','private','trash') NOT NULL DEFAULT 'draft',
    author_id BIGINT UNSIGNED NOT NULL,
    parent_id BIGINT UNSIGNED NULL,
    template VARCHAR(64) NOT NULL DEFAULT 'default',
    is_sticky TINYINT(1) NOT NULL DEFAULT 0,
    allow_comments TINYINT(1) NOT NULL DEFAULT 1,
    views BIGINT UNSIGNED NOT NULL DEFAULT 0,
    reading_time SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    seo_title VARCHAR(255) NULL,
    seo_description VARCHAR(320) NULL,
    published_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_posts_listing (type, status, published_at),
    INDEX idx_posts_author (author_id),
    INDEX idx_posts_slug (slug),
    CONSTRAINT fk_posts_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_posts_parent FOREIGN KEY (parent_id) REFERENCES posts(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS post_categories (
    post_id BIGINT UNSIGNED NOT NULL,
    category_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (post_id, category_id),
    INDEX idx_pc_category (category_id),
    CONSTRAINT fk_pc_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    CONSTRAINT fk_pc_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS post_tags (
    post_id BIGINT UNSIGNED NOT NULL,
    tag_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (post_id, tag_id),
    INDEX idx_pt_tag (tag_id),
    CONSTRAINT fk_pt_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    CONSTRAINT fk_pt_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS revisions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    post_id BIGINT UNSIGNED NOT NULL,
    title VARCHAR(255) NOT NULL,
    content MEDIUMTEXT NOT NULL,
    excerpt TEXT NULL,
    author_id BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_revisions_post (post_id, created_at),
    CONSTRAINT fk_revisions_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS comments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    post_id BIGINT UNSIGNED NOT NULL,
    parent_id BIGINT UNSIGNED NULL,
    author_name VARCHAR(120) NOT NULL,
    author_email VARCHAR(190) NULL,
    author_url VARCHAR(255) NULL,
    content TEXT NOT NULL,
    status ENUM('pending','approved','spam','trash') NOT NULL DEFAULT 'pending',
    user_id BIGINT UNSIGNED NULL,
    ip_address VARCHAR(64) NULL,
    user_agent VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_comments_post (post_id, status),
    INDEX idx_comments_status (status, created_at),
    CONSTRAINT fk_comments_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS media_meta (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    media_id BIGINT UNSIGNED NOT NULL,
    meta_key VARCHAR(80) NOT NULL,
    meta_value TEXT NULL,
    UNIQUE KEY uq_media_meta (media_id, meta_key),
    CONSTRAINT fk_media_meta FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /*
    Per-post key/value sidecar.

    This exists so the trash can remember the status a post had before it was
    binned, and restore it to exactly that status. It is a *new table* rather
    than a column on `posts` on purpose: migrate() only ever runs
    CREATE TABLE IF NOT EXISTS statements, so a new table reaches databases that
    were installed by an earlier version, whereas an ALTER TABLE would not.
  */
  `CREATE TABLE IF NOT EXISTS post_meta (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    post_id BIGINT UNSIGNED NOT NULL,
    meta_key VARCHAR(80) NOT NULL,
    meta_value TEXT NULL,
    UNIQUE KEY uq_post_meta (post_id, meta_key),
    CONSTRAINT fk_post_meta FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS subscribers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(190) NOT NULL UNIQUE,
    name VARCHAR(120) NULL,
    status ENUM('pending','confirmed','unsubscribed') NOT NULL DEFAULT 'confirmed',
    token VARCHAR(64) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS post_views (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    post_id BIGINT UNSIGNED NOT NULL,
    day DATE NOT NULL,
    views INT UNSIGNED NOT NULL DEFAULT 0,
    UNIQUE KEY uq_views_day (post_id, day),
    INDEX idx_views_day (day),
    CONSTRAINT fk_views_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS redirects (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    from_path VARCHAR(255) NOT NULL UNIQUE,
    to_path VARCHAR(255) NOT NULL,
    status_code SMALLINT NOT NULL DEFAULT 301,
    hits INT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS activity (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NULL,
    action VARCHAR(64) NOT NULL,
    subject VARCHAR(255) NULL,
    meta TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_activity_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS sessions (
    sid VARCHAR(128) NOT NULL PRIMARY KEY,
    data MEDIUMTEXT NOT NULL,
    expires BIGINT UNSIGNED NOT NULL,
    INDEX idx_sessions_expires (expires)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS contact_messages (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(190) NOT NULL,
    subject VARCHAR(190) NULL,
    message TEXT NOT NULL,
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    ip_address VARCHAR(64) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_messages_read (is_read, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS menu_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    location ENUM('primary','footer','legal') NOT NULL DEFAULT 'primary',
    label VARCHAR(120) NOT NULL,
    url VARCHAR(255) NOT NULL,
    parent_id BIGINT UNSIGNED NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    target ENUM('_self','_blank') NOT NULL DEFAULT '_self'
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /*
    Per-member AI entitlement.

    One row per user, created only when an administrator grants access — the
    absence of a row is itself meaningful and means "not entitled". Nothing here
    is derived from `users.role`, so promoting somebody to editor does not
    silently hand them the assistant, and a new member of any role starts with
    no model assigned.

    A new table rather than columns on `users` for the same reason as post_meta:
    migrate() only runs CREATE TABLE IF NOT EXISTS, so this reaches databases
    installed by an earlier version, where an ALTER TABLE would not.

    `base_url` + `model` empty means entitled-but-unassigned: the member sees the
    card and is told no model has been assigned, and compose is refused. They
    never fall back to the site-wide key, because that key belongs to the
    administrator's own account and spending it on the member's behalf was never
    an explicit decision.

    `key_owner` records who supplied `api_key`, which is what lets the member
    edit their own key on their profile without being able to overwrite one an
    administrator assigned. `preset_id` keeps a member's own key inside the set
    of providers the administrator approved, so a member cannot point the CMS at
    an arbitrary endpoint.

    The CASCADE matches posts.author_id: deleting a member must not leave an
    entitlement — or a saved API key — behind.
  */
  `CREATE TABLE IF NOT EXISTS user_ai (
    user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    is_enabled TINYINT(1) NOT NULL DEFAULT 0,
    base_url VARCHAR(300) NOT NULL DEFAULT '',
    model VARCHAR(120) NOT NULL DEFAULT '',
    image_model VARCHAR(120) NOT NULL DEFAULT '',
    api_key VARCHAR(300) NOT NULL DEFAULT '',
    key_owner ENUM('admin','member') NOT NULL DEFAULT 'admin',
    preset_id VARCHAR(60) NOT NULL DEFAULT '',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_ai_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

export const SCHEMA_VERSION = 2;

export const DEFAULT_SETTINGS: Record<string, string> = {
  site_title: 'Gravy',
  site_tagline: 'A publication for people who make things.',
  site_description:
    'Gravy is an independent journal about good work, slow travel and the creative life — served warm, twice a week.',
  site_url: '',
  logo_text: 'Gravy',
  logo_mark: 'drop',
  accent_color: '#206bea',
  default_theme: 'light',
  posts_per_page: '9',
  /*
    Shape of every post URL. Tokens: %slug% %post_id% %year% %month% %day%
    %category%. `/posts/%slug%` is the default; `/%slug%` is the shortest form
    an administrator can ask for. Re-validated by normalizeStructure() on read
    as well as on save, so a bad value can never make post URLs unbuildable —
    it falls back to the default instead.
  */
  permalink_structure: '/posts/%slug%',
  homepage_layout: 'editorial',
  homepage_featured_count: '1',
  spotlight_category: '',
  auto_load_next: '1',
  before_you_go: '1',
  show_reading_time: '1',
  show_author_box: '1',
  show_related_posts: '1',
  show_toc: '1',
  allow_comments: '1',
  comment_moderation: '1',
  comment_notify_email: '',
  newsletter_enabled: '1',
  newsletter_heading: 'The Sunday Letter',
  newsletter_text:
    'One thoughtful letter each week: what we read, what we made, and one idea worth keeping. No noise, ever.',
  footer_about:
    'Gravy is a small, independent publication about work that matters and the life around it. Written by humans. Read with coffee.',
  footer_copyright: '© {year} Gravy. All rights reserved.',
  social_twitter: 'https://twitter.com/',
  social_instagram: 'https://instagram.com/',
  social_linkedin: 'https://linkedin.com/',
  social_youtube: '',
  contact_email: 'hello@gravy.local',
  seo_default_image: '',
  analytics_snippet: '',
  timezone: 'UTC',
  date_format: 'long',
  admin_footer_note: 'Gravy CMS',

  /*
    AI drafting assistant — administrators only.

    Enabled by default, but that is not the same as live. The defaults below
    point at OpenAI, which requires a key, so `describeAiReadiness` reports not
    ready and nothing is sent anywhere on a fresh install. What enabling it by
    default changes is the first-run experience: the administrator sees the
    provider presets and a ready/off pill, instead of a feature that looks
    absent and has to be discovered.

    `ai_base_url` points at any OpenAI-compatible /chat/completions endpoint, so
    Groq, OpenRouter, Mistral, Gemini, OpenAI and a keyless local server
    (Ollama, LM Studio, llama.cpp and the rest) all work without a code change.
    `ai_api_key` is genuinely optional: when it is empty no Authorization header
    is sent at all, which is what an unauthenticated server expects. Azure
    OpenAI is the notable exception — it authenticates with an `api-key` header
    and an `api-version` parameter, so it cannot work through this client.

    Seeding is non-destructive (ON DUPLICATE KEY UPDATE setting_value =
    setting_value), so an existing install that switched the assistant off keeps
    it off — and an existing install keeps whatever provider it already chose.
  */
  ai_enabled: '1',
  ai_base_url: 'https://api.openai.com/v1',
  ai_api_key: '',
  ai_model: 'gpt-4o-mini',
  /*
    Feature images are a different capability from chat, so they get their own
    model id. Blank means "no image-capable provider is configured", and the
    keyless fallback draws the picture instead — which is also what happens on
    shared hosting, where no local image server can run at all.
  */
  ai_image_model: '',
  ai_max_tokens: '1400',
  ai_diagrams: '1',
  /*
    Which provider presets a granted member may point their OWN key at, as a
    comma-separated list of preset ids (for example `groq,openrouter`).

    Empty by default, and empty means closed: until an administrator approves
    something, no member can self-serve a key at all. That is deliberate. A
    member's own key still has to travel through this server, and without a
    list like this they could point the CMS at any OpenAI-compatible endpoint on
    the internet — including one they control, which would route other people's
    drafts through it. Restricting the choice to approved presets keeps the base
    URL an administrator's decision while leaving the key the member's.

    Only presets are ever valid here; a member cannot save a base URL that is not
    on the list.
  */
  ai_member_presets: '',
};

/** Small, deliberate set of navigation defaults (editable in Admin → Menus). */
export const DEFAULT_MENU: Array<{ location: 'primary' | 'footer' | 'legal'; label: string; url: string; sort_order: number }> = [
  { location: 'primary', label: 'Home', url: '/', sort_order: 0 },
  { location: 'primary', label: 'Posts', url: '/posts', sort_order: 1 },
  { location: 'primary', label: 'Categories', url: '/categories', sort_order: 2 },
  { location: 'primary', label: 'About', url: '/about', sort_order: 3 },
  { location: 'primary', label: 'Contact', url: '/contact', sort_order: 4 },
  { location: 'footer', label: 'Posts', url: '/posts', sort_order: 0 },
  { location: 'footer', label: 'Categories', url: '/categories', sort_order: 1 },
  { location: 'footer', label: 'Archive', url: '/archive', sort_order: 2 },
  { location: 'footer', label: 'About', url: '/about', sort_order: 3 },
  { location: 'footer', label: 'Contact', url: '/contact', sort_order: 4 },
  { location: 'legal', label: 'Privacy', url: '/privacy', sort_order: 0 },
  { location: 'legal', label: 'Terms', url: '/terms', sort_order: 1 },
  { location: 'legal', label: 'RSS', url: '/feed.xml', sort_order: 2 },
];
