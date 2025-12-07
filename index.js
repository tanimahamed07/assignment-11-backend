require("dotenv").config();
require("dotenv").config();
const express = require("express");
const cors = require("cors");
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
    app.get('/my-loan/:email', async(req, res) => {
      const result = await applicationsCollection.find({userEmail: req.params.email}).toArray()
      res.send(result)
    })

    //dealate user lone
    app.delete('/loan-application/:id', async(req, res) => {
      const id = req.params.id
      const result = await applicationsCollection.deleteOne({_id : new ObjectId(id)})
      res.send(result)
    })



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
    app.post('/loan/application', async(req, res)=>{
      const data = req.body
      const result = await applicationsCollection.insertOne(data)
      res.send({result, success: true})
    })

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
