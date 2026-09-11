CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AlterTable
ALTER TABLE "articles" ADD COLUMN     "search_vector" tsvector;

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "search_vector" tsvector;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "search_vector" tsvector;

-- CreateIndex
CREATE INDEX "articles_search_vector_idx" ON "articles" USING GIN ("search_vector");

-- CreateIndex
CREATE INDEX "articles_title_idx" ON "articles" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "listings_search_vector_idx" ON "listings" USING GIN ("search_vector");

-- CreateIndex
CREATE INDEX "listings_title_idx" ON "listings" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "posts_search_vector_idx" ON "posts" USING GIN ("search_vector");

-- CreateIndex
CREATE INDEX "posts_title_idx" ON "posts" USING GIN ("title" gin_trgm_ops);

-- Keep search vectors in sync (simple config: language-agnostic, works for zh/en tokens)
CREATE OR REPLACE FUNCTION listings_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.body, '')), 'B');
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER listings_search_vector_trg BEFORE INSERT OR UPDATE OF title, body
  ON "listings" FOR EACH ROW EXECUTE FUNCTION listings_search_vector_update();

CREATE OR REPLACE FUNCTION posts_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.body, '')), 'B');
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER posts_search_vector_trg BEFORE INSERT OR UPDATE OF title, body
  ON "posts" FOR EACH ROW EXECUTE FUNCTION posts_search_vector_update();

CREATE OR REPLACE FUNCTION articles_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.summary, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.body, '')), 'C');
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER articles_search_vector_trg BEFORE INSERT OR UPDATE OF title, summary, body
  ON "articles" FOR EACH ROW EXECUTE FUNCTION articles_search_vector_update();
