/* eslint-disable no-undef */
/* eslint-disable no-unused-vars */

const express = require("express");
const app = express();
const { Todo, User } = require("./models");
const bodyParser = require("body-parser");
const csrf = require("tiny-csrf");
const cookieParser = require("cookie-parser");
const path = require("path");

const passport = require("passport");
const connectEnsureLogin = require("connect-ensure-login");
const session = require("express-session");
const LocalStrategy = require("passport-local");
const bcrypt = require("bcrypt");
const saltRounds = 10;

const flash = require("connect-flash");
app.set("views", path.join(__dirname, "views")); //set the views globally
app.use(flash());

app.use(bodyParser.json()); //for parsing the request body

app.use(express.urlencoded({ extended: false })); //for taking the details from url

app.use(cookieParser("shh! some secret string"));
app.use(csrf("this_should_be_32_character_long", ["POST", "PUT", "DELETE"]));

//for using the login session
app.use(
  session({
    secret: "my-super-secret-key-21728172615261562",
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, //24hrs
    },
  }),
);

app.use((request, response, next) => {
  response.locals.messages = request.flash(); //allows every ejs files to use flash
  next();
});

app.use(passport.initialize());
app.use(passport.session());

//for signing in
passport.use(
  new LocalStrategy(
    {
      usernameField: "email",
      passwordField: "password",
    },
    (username, password, done) => {
      User.findOne({
        where: {
          email: username,
        },
      })
        .then(async (user) => {
          if (user) {
            const result = await bcrypt.compare(password, user.password);
            if (result) {
              return done(null, user);
            } else {
              return done(null, false, { message: "Invalid password" });
            }
          } else {
            return done(null, false, { message: "Invalid username" });
          }
        })
        .catch((error) => {
          return error;
        });
    },
  ),
);

passport.serializeUser((user, done) => {
  console.log("Serializing user in session", user.id);
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  User.findByPk(id)
    .then((user) => {
      done(null, user);
    })
    .catch((error) => {
      done(error, null);
    });
});

app.set("view engine", "ejs"); //set the ejs engine

app.get("/", async (request, response) => {
  if (request.user) {
    return response.redirect("/todos");
  } else {
    return response.render("index", {
      title: "Todo application",
      csrfToken: request.csrfToken(),
    });
  }
});

app.use(express.static(path.join(__dirname, "public"))); //for rendering static contents like css and js

app.get(
  "/todos",
  //for making session private
  connectEnsureLogin.ensureLoggedIn(),
  async (request, response) => {
    const loggedInUser = request.user.id;
    const overdueItems = await Todo.overdue(loggedInUser);
    const dueTodayItems = await Todo.dueToday(loggedInUser);
    const dueLaterItems = await Todo.dueLater(loggedInUser);
    const completedItems = await Todo.completed(loggedInUser);

    if (request.accepts("html")) {
      response.render("todos", {
        title: "Todo application",
        overdueItems,
        dueTodayItems,
        dueLaterItems,
        completedItems,
        csrfToken: request.csrfToken(),
      }); //render the ejs  page to display
    } else {
      //for postman or other api checking
      return response.json({
        overdueItems,
        dueTodayItems,
        dueLaterItems,
        completedItems,
      });
    }
  },
);

app.get("/signup", (request, response) => {
  response.render("signup", {
    title: "Sign up",
    csrfToken: request.csrfToken(),
  });
});

app.post("/users", async (request, response) => {
  const hashedPwd = await bcrypt.hash(request.body.password, saltRounds);
  try {
    const user = await User.create({
      firstName: request.body.firstName,
      lastName: request.body.lastName,
      email: request.body.email,
      password: hashedPwd,
    });

    //login is a method attached to request by passport
    request.login(user, (err) => {
      if (err) {
        throw err;
      }
      return response.redirect("/todos");
    });
  } catch (error) {
    const msg = error.errors[0].message;
    request.flash("error", msg);
    return response.redirect("/signup");
  }
});

app.get("/login", (request, response) => {
  response.render("login", {
    title: "Login",
    csrfToken: request.csrfToken(),
  });
});

//next is a function that pass it to the next route handler
app.get("/signout", (request, response, next) => {
  request.logout((err) => {
    if (err) {
      return next(err);
    }
    return response.redirect("/");
  });
});

app.post(
  "/session",
  passport.authenticate("local", {
    failureRedirect: "/login",
    failureFlash: true,
  }),
  (request, response) => {
    return response.redirect("/todos");
  },
);

app.post(
  "/todos",
  connectEnsureLogin.ensureLoggedIn(),
  async (request, response) => {
    console.log("Creating a todo", request.body);
    try {
      await Todo.addTodo({
        title: request.body.title,
        dueDate: request.body.dueDate,
        userId: request.user.id, //request.user is a method attached by passport
      });
      return response.redirect("/todos");
    } catch (error) {
      const msg = error.errors[0].message;
      request.flash("error", msg);
      return response.redirect("/todos");
    }
  },
);

app.put(
  "/todos/:id",
  connectEnsureLogin.ensureLoggedIn(),
  async (request, response) => {
    console.log("We have to update a todo with id:", request.params.id);
    const todo = await Todo.findByPk(request.params.id);
    try {
      const updatedTodo = await todo.setCompletionStatus(
        request.body.completed,
      );
      return response.json(updatedTodo);
    } catch (error) {
      console.error(error);
      return response.status(422).json(error);
    }
  },
);

app.delete(
  "/todos/:id",
  connectEnsureLogin.ensureLoggedIn(),
  async (request, response) => {
    console.log("Delete a todo by id:", request.params.id);
    try {
      await Todo.remove(request.params.id, request.user.id);
      return response.json(true);
    } catch (error) {
      console.error(error);
      return response.status(422).json(false);
    }
  },
);

module.exports = app;
