FROM denoland/deno:1.29.1

WORKDIR /app
USER deno

ADD . .
RUN deno cache twitter_name_clock.ts

CMD ["run", "--allow-net", "--allow-env", "twitter_name_clock.ts"]
