const path = require("node:path");
const webpack = require("webpack");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");

webpack(
  {
    mode: "production",
    target: "node",
    entry: Object.fromEntries(
      ["main", "worker"].map((name) => [
        name,
        path.resolve(
          __dirname,
          `../maintenance/rich-text-normalization/${name}.ts`,
        ),
      ]),
    ),
    output: {
      path: path.resolve(__dirname, "../dist/rich-text-migration"),
      filename: "[name].js",
    },
    resolve: { extensions: [".ts", ".js"] },
    externals: {
      "@prisma/client": "commonjs @prisma/client",
      jsdom: "commonjs jsdom",
    },
    node: { __dirname: false, __filename: false },
    plugins: [
      new webpack.DefinePlugin({
        __RICH_TEXT_MIGRATION_LOCK_HASH__: JSON.stringify(
          createHash("sha256")
            .update(readFileSync(path.resolve(__dirname, "../../../yarn.lock")))
            .digest("hex"),
        ),
      }),
    ],
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: {
            loader: "ts-loader",
            options: {
              configFile: path.resolve(
                __dirname,
                "../tsconfig.rich-text-migration.json",
              ),
              transpileOnly: true,
            },
          },
        },
      ],
    },
    optimization: { minimize: false },
  },
  (error, stats) => {
    if (error || stats.hasErrors()) {
      console.error(
        error?.message || stats.toString({ all: false, errors: true }),
      );
      process.exitCode = 1;
    } else
      console.log("Built standalone rich-text migration and isolated parser.");
  },
);
