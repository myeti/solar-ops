-- ─────────────────────────────────────────────────────────────────────
-- SolarOps test bench fixtures (run once, when the volume is created).
-- TEST PASSWORDS ONLY.
-- ─────────────────────────────────────────────────────────────────────

-- The admin role SolarOps uses: what deploy/install.sh creates on a
-- server with a local PostgreSQL (CREATEDB + CREATEROLE, not superuser).
CREATE ROLE solarops_admin WITH LOGIN CREATEDB CREATEROLE PASSWORD 'solarops-admin-test';

-- A database that already runs before SolarOps: link it to a project with
-- "Link an existing database" (or paste its URL):
--   postgres://legacy_shop:legacy-shop-test@postgres:5432/legacy_shop
CREATE ROLE legacy_shop WITH LOGIN PASSWORD 'legacy-shop-test';
CREATE DATABASE legacy_shop OWNER legacy_shop;

-- Same name as the uid of a project called "Blog": SolarOps must refuse to
-- create it and offer to link it instead.
--   postgres://blog:blog-test@postgres:5432/blog
CREATE ROLE blog WITH LOGIN PASSWORD 'blog-test';
CREATE DATABASE blog OWNER blog;

\connect legacy_shop
SET ROLE legacy_shop;

CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL
);

CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products (id),
  quantity INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO products (name, price) VALUES ('Rocket', 99.90), ('Telescope', 249.00), ('Star map', 12.50);
INSERT INTO orders (product_id, quantity) VALUES (1, 2), (2, 1), (3, 5);

\connect blog
SET ROLE blog;

CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO posts (title) VALUES ('Hello, universe'), ('Why every project needs a planet');
