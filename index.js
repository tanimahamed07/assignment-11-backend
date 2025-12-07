require("dotenv").config();
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const port = process.env.PORT || 3000;
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);

const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
// middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "https://b12-m11-session.web.app",
    ],
    credentials: true,
    optionSuccessStatus: 200,
  })
);
app.use(express.json());

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    console.log(decoded);
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    await client.connect();

    const db = client.db("loanLink");
    const loansCollection = db.collection("loans");
    const usersCollection = db.collection("users");
    const applicationsCollection = db.collection("applications");

    //  get loans for home page
    app.post('/loans', async(req, res) => {
      const loan = req.body
      const result = await loansCollection.insertOne(loan)
      res.send(result)
    })



    app.get("/loans-home", async (req, res) => {
      const result = await loansCollection.find({ showOnHome: true }).toArray();
      res.send(result);
    });
    // get all loans
    app.get("/loans", async (req, res) => {
      const result = await loansCollection.find({}).toArray();
      res.send(result);
    });
    // get loan details
    app.get("/loan-details/:id", async (req, res) => {
      console.log(req.params.id);
      const result = await loansCollection.findOne({
        _id: new ObjectId(req.params.id),
      });
      res.send(result);
    });
    // get user lone
    app.get("/my-loan/:email", async (req, res) => {
      const result = await applicationsCollection
        .find({ userEmail: req.params.email })
        .toArray();
      res.send(result);
    });

    // add loans in db 


    //dealate user lone
    app.delete("/loan-application/:id", async (req, res) => {
      const id = req.params.id;
      const result = await applicationsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // payment checkout
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: paymentInfo.loanTitle,
                description: `$${paymentInfo.amount}`,
                images: [paymentInfo.image],
              },
              unit_amount: paymentInfo.amount * 100,
            },
            quantity: paymentInfo.quantity,
          },
        ],
        customer_email: paymentInfo.borrower?.email,
        mode: "payment",
        metadata: {
          loanApplicationId: paymentInfo.loanApplicationId,
          borrower: paymentInfo.borrower?.email,
        },
        success_url: `http://localhost:5173/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `http://localhost:5173/loans`,
      });

      res.send({ url: session.url });
    });

    app.get("/payment-success", async (req, res) => {
      const { session_id } = req.query;

      try {
        // Retrieve the session from Stripe
        const session = await stripe.checkout.sessions.retrieve(session_id);

        // Check if payment succeeded
        if (session.payment_status === "paid") {
          const loanApplicationId = session.metadata.loanApplicationId;

          if (!loanApplicationId) {
            return res.status(400).json({
              success: false,
              message: "No loanApplicationId in session metadata",
            });
          }

          // Update the loan application fee status in the database
          const result = await applicationsCollection.updateOne(
            { _id: new ObjectId(loanApplicationId) },
            {
              $set: {
                applicationFeeStatus: "Paid",
                stripePaymentId: session.payment_intent,
                paymentEmail: session.customer_email,
                paymentAmount: session.amount_total / 100,
                paidAt: new Date(),
              },
            }
          );

          return res.status(200).json({
            success: true,
            message: "Payment successful",
            loanApplicationId,
            stripePaymentId: session.payment_intent,
          });
        } else {
          return res
            .status(400)
            .json({ success: false, message: "Payment not completed" });
        }
      } catch (error) {
        console.error("Payment success error:", error);
        return res.status(500).json({
          success: false,
          message: "Server error",
          error: error.message,
        });
      }
    });

    // save or update a user in db
    app.post("/user", async (req, res) => {
      const userData = req.body;
      userData.created_at = new Date().toISOString();
      userData.last_loggedIn = new Date().toISOString();
      userData.role = userData.role || "borrower";
      userData.status = "active";
      const query = {
        email: userData.email,
      };

      const alreadyExists = await usersCollection.findOne(query);
      console.log("User Already Exists---> ", !!alreadyExists);

      if (alreadyExists) {
        console.log("Updating user info......");
        const result = await usersCollection.updateOne(query, {
          $set: {
            last_loggedIn: new Date().toISOString(),
          },
        });
        return res.send(result);
      }

      console.log("Saving new user info......");
      const result = await usersCollection.insertOne(userData);
      res.send(result);
    });

    //loan application save in db
    app.post("/loan/application", async (req, res) => {
      const data = req.body;
      const result = await applicationsCollection.insertOne(data);
      res.send({ result, success: true });
    });

    // get user role
    app.get("/user/role", verifyJWT, async (req, res) => {
      const result = await usersCollection.findOne({ email: req.tokenEmail });
      res.send({ role: result?.role });
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from Server..");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
