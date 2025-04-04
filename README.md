# not-express

`not-express` is a partial but fun re-implementation of Express.

Express is often described as a fast, unopinionated, minimalist web framework for Node.js. However, in practice, it is a full-featured framework with many functionalities that may not be necessary for simple web applications.

The goal of `not-express` is to support a minimal set of features while remaining as compatible as possible with the Express API, with the least amount of code. It could be thought as a strict sub-set of Express: You can start playing with `not-express` and, if there is a feature of Express you need, just swap it for `express` and everything should keep working.

Working on `not-express` has been a fun and educational experience that deepened my understanding of how Connect and Express work. Even after using both for more than 10 years, there always seems to be something new to learn. I hope you find `not-express` both useful and enjoyable, whether you use it in your projects or as a learning tool.

## Highlights

- **No Dependencies**: Built entirely with no dependencies other than Node.js's built-in `http` module.
- **Lightweight**: Less than 100 lines of code (without counting the comments).
- **Connect/Express-Like API**: Familiar `get`, `use`, and `listen` methods.
- **Static and Dynamic Routes**: Supports routes defined using strings or regular expressions with capture groups for path parameters.
- **Middleware Support**: Handles requests through middleware and error-handling functions, transferring control with `next()`.
- **Default Error Handling**: Automatically responds with 404 and 500 errors if calls or errors were not handled.
- **Simple CORS Middleware**: Optional lightweight (and very limited) CORS support.

## Installation and Usage

Install the package as usual with:

```sh
npm install not-express
```

Then use it as you would use Express:

```js
const express = require("not-express");
const app = express();

app.get("/", function (req, res) {
  res.end("Hello World!");
});

app.listen(3000);
```
