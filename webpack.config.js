// Variables in .env and .env.defaults will be added to process.env
const dotenv = require("dotenv");

if (process.env.NODE_ENV === "production") {
  dotenv.config({ path: ".env.prod" });
} else if (process.env.NODE_ENV === "test") {
  dotenv.config({ path: ".env.test" });
} else {
  dotenv.config({ path: ".env" });
  dotenv.config({ path: ".env.defaults" });
}

const fs = require("fs");
const selfsigned = require("selfsigned");
const cors = require("cors");
const HTMLWebpackPlugin = require("html-webpack-plugin");
const path = require("path");
const webpack = require("webpack");
const TerserJSPlugin = require("terser-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const BundleAnalyzerPlugin = require("webpack-bundle-analyzer").BundleAnalyzerPlugin;

function createHTTPSConfig() {
  // Generate certs for the local webpack-dev-server.
  if (fs.existsSync(path.join(__dirname, "certs"))) {
    const key = fs.readFileSync(path.join(__dirname, "certs", "key.pem"));
    const cert = fs.readFileSync(path.join(__dirname, "certs", "cert.pem"));

    return { key, cert };
  } else {
    const pems = selfsigned.generate(
      [
        {
          name: "commonName",
          value: "localhost"
        }
      ],
      {
        days: 365,
        keySize: 2048,
        algorithm: "sha256",
        keySize: 2048,
        extensions: [
          {
            name: "subjectAltName",
            altNames: [
              {
                type: 2,
                value: "localhost"
              },
              {
                type: 2,
                value: "hubs.local"
              }
            ]
          }
        ]
      }
    );

    fs.mkdirSync(path.join(__dirname, "certs"));
    fs.writeFileSync(path.join(__dirname, "certs", "cert.pem"), pems.cert);
    fs.writeFileSync(path.join(__dirname, "certs", "key.pem"), pems.private);

    return {
      key: pems.private,
      cert: pems.cert
    };
  }
}

const defaultHostName = "hubs.local";
const host = process.env.HOST_IP || defaultHostName;
const port = process.env.HOST_PORT || 9090;
const internalHostname = process.env.INTERNAL_HOSTNAME || defaultHostName;

module.exports = env => {
  return {
    entry: {
      entry: ["./src/index.js"]
    },

    devtool: process.env.NODE_ENV === "production" ? "source-map" : "inline-source-map",

    devServer: {
      https: createHTTPSConfig(),
      historyApiFallback: true,
      port,
      host: process.env.HOST_IP || "0.0.0.0",
      public: `${host}:${port}`,
      publicPath: process.env.BASE_ASSETS_PATH || "",
      useLocalIp: true,
      allowedHosts: [host, internalHostname],
      headers: {
        "Access-Control-Allow-Origin": "*"
      },
      before: function(app) {
        // be flexible with people accessing via a local reticulum on another port
        app.use(cors({ origin: /hubs\.local(:\d*)?$/ }));
      }
    },

    output: {
      filename: "assets/js/[name]-[chunkhash].js",
      publicPath: process.env.BASE_ASSETS_PATH || "/"
    },

    module: {
      rules: [
        {
          test: /\.(png|jpg|jpeg|gif|svg)(\?.*$|$)/,
          use: {
            loader: "file-loader",
            options: {
              name: "[name]-[hash].[ext]",
              outputPath: "assets/images"
            }
          }
        },
        {
          test: /\.(woff|woff2|ttf|eot)(\?.*$|$)/,
          use: {
            loader: "file-loader",
            options: {
              name: "[name]-[hash].[ext]",
              outputPath: "assets/fonts"
            }
          }
        },
        {
          test: /\.(glb)(\?.*$|$)/,
          use: {
            loader: "file-loader",
            options: {
              name: "[name]-[hash].[ext]",
              outputPath: "assets/models"
            }
          }
        },
        {
          test: /\.(gltf)(\?.*$|$)/,
          use: {
            loader: "gltf-webpack-loader",
            options: {
              name: "[name]-[hash].[ext]",
              outputPath: "assets/models"
            }
          }
        },
        {
          test: /\.(bin)$/,
          use: [
            {
              loader: "file-loader",
              options: {
                name: "[name]-[hash].[ext]",
                outputPath: "assets/models"
              }
            }
          ]
        },
        {
          test: /\.(mp4|webm)(\?.*$|$)/,
          use: {
            loader: "file-loader",
            options: {
              name: "[name]-[hash].[ext]",
              outputPath: "assets/videos"
            }
          }
        },
        {
          test: /\.(spoke)(\?.*$|$)/,
          use: {
            loader: "file-loader",
            options: {
              name: "[name]-[hash].[ext]",
              outputPath: "assets/templates"
            }
          }
        },
        {
          test: /\.js$/,
          include: path.join(__dirname, "src"),
          use: "babel-loader"
        },
        {
          test: /\.worker\.js$/,
          include: path.join(__dirname, "src"),
          loader: "worker-loader",
          options: {
            // Workers must be inlined because they are hosted on a CDN and CORS doesn't permit us
            // from loading worker scripts from another origin. To minimize bundle size, dynamically
            // import a wrapper around the worker. See SketchfabZipLoader.js and API.js for an example.
            name: "assets/js/workers/[name]-[hash].js",
            inline: true,
            fallback: false
          }
        },
        {
          test: /\.wasm$/,
          type: "javascript/auto",
          use: {
            loader: "file-loader",
            options: {
              outputPath: "assets/js/wasm",
              name: "[name]-[hash].[ext]"
            }
          }
        }
      ]
    },

    target: "web",
    node: {
      __dirname: false,
      fs: "empty",
      Buffer: false,
      process: false
    },

    optimization: {
      minimizer: [new TerserJSPlugin({ sourceMap: true, parallel: true, cache: path.join(__dirname, ".tersercache") })]
    },

    plugins: [
      new BundleAnalyzerPlugin({
        analyzerMode: env && env.BUNDLE_ANALYZER ? "server" : "disabled"
      }),
      new CopyWebpackPlugin([
        {
          from: path.join(
            __dirname,
            "src",
            "assets",
            process.env.IS_MOZ === "true" ? "favicon-spoke.ico" : "favicon-editor.ico"
          ),
          to: "assets/images/favicon.ico"
        }
      ]),
      new CopyWebpackPlugin([
        {
          from: path.join(__dirname, "src", "assets", "favicon-spoke.ico"),
          to: "assets/images/favicon-spoke.ico"
        }
      ]),
      new CopyWebpackPlugin([
        {
          from: path.join(__dirname, "src", "assets", "favicon-editor.ico"),
          to: "assets/images/favicon-editor.ico"
        }
      ]),
      new HTMLWebpackPlugin({
        template: path.join(__dirname, "src", "index.html"),
        faviconPath: (process.env.BASE_ASSETS_PATH || "/") + "assets/images/favicon.ico"
      }),
      new webpack.EnvironmentPlugin({
        BUILD_VERSION: "dev",
        NODE_ENV: "development",
        RETICULUM_SERVER: undefined,
        THUMBNAIL_SERVER: "",
        HUBS_SERVER: undefined,
        CORS_PROXY_SERVER: null,
        BASE_ASSETS_PATH: "",
        NON_CORS_PROXY_DOMAINS: "",
        ROUTER_BASE_PATH: "",
        SENTRY_DSN: null,
        GA_TRACKING_ID: null,
        IS_MOZ: false,
        GITHUB_ORG: "mozilla",
        GITHUB_REPO: "spoke",
        GITHUB_PUBLIC_TOKEN: "ghp_SAFEPB2zzes9TEpAOSx2McNjJLQ1GXLBES2FsfWU"
      })
    ]
  };
};
