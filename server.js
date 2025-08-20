const express=require('express');
const dotenv=require('dotenv').config();
const mongoose=require('mongoose');
const bcrypt=require('bcryptjs');
const session= require('express-session');
const app=express();
const Mongodbstore=require('connect-mongodb-session')(session);
const cookieParser=require('cookie-parser');
const http=require('http');
const {Server}=require('socket.io');
const jwt=require('jsonwebtoken');
const dayjs=require('dayjs');
const utc=require('dayjs/plugin/utc');
const timezone=require('dayjs/plugin/timezone');
const Chat=require('./models/Chat');
const path = require('path');
dayjs.extend(utc);
dayjs.extend(timezone);
const nodemailer = require("nodemailer");


const User=require('./models/User')
const store=new Mongodbstore({
    uri:process.env.MONGODB_URI
,
    collection:'session'
})
store.on('error',function(error){
    console.log('Session store error',error);
})
let otpStore = {};
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(cookieParser());
app.use(
    session({
        secret:'revanth',
        resave:false,
        saveUninitialized:false,
        store:store,
        cookie:{
            maxAge:1000*60*60*24, 
            secure:false, 
            httpOnly:true 
        }
    })
)

app.set('view engine','ejs');
app.set('views', path.join(__dirname, 'views'));

function isAuth(req,res,next){
    if(req.session.user){
        next();
    }
    else{
        res.render('login');
    }
}

app.get('/',(req,res)=>{
    res.render('login');
})

app.get('/login',(req,res)=>{
    res.render('login');
})
app.get('/register',(req,res)=>{
    res.render('register');
})
app.get('/verify-otp',(req,res)=>{
    res.render('verify-otp');
})

app.get('/logout',(req,res)=>{
    req.session.destroy((err)=>{
        if(err){
            console.error('Error destroying session:', err);
            return res.status(500).send('Error logging out');
        }
        res.clearCookie('connect.sid'); // Clear the session cookie
        res.redirect('/login');
    });
});

const server=http.createServer(app);
const io=new Server(server);

mongoose.connect(process.env.MONGODB_URI
)
.then(
    console.log('Database connected successfully')
)
.catch(err=>{
    console.log('Database connection failed', err);
})


// ✅ Create transporter once
const transporter = nodemailer.createTransport({
  service: "gmail",  // or "hotmail", "yahoo", or SMTP config
  auth: {
    user: process.env.EMAIL,   // your email
    pass: process.env.EMAIL_PASS // your app password
  }
});

app.post("/register", async (req, res) => {
  try {
    const { Name, Email, Password, ConfirmPassword } = req.body;

    if (Password !== ConfirmPassword) {
      return res.send('<script>alert("Passwords do not match");window.location="/register";</script>');
    }

    const existingUser = await User.findOne({ Email });
    if (existingUser) {
      return res.send('<script>alert("Email already registered");window.location="/register";</script>');
    }

    const hashedPassword = await bcrypt.hash(Password, 10);

    // ✅ Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // ✅ Store in temporary memory
    otpStore[Email] = {
      Name,
      Email,
      Password: hashedPassword,
      otp,
      expires: Date.now() + 10 * 60 * 1000
    };
    nodemailer.createTransport({ service: "gmail", auth: { user: process.env.EMAIL, pass: process.env.EMAIL_PASS, }, });

    // ✅ Use transporter.sendMail, not nodemailer.sendMail
    await transporter.sendMail({
      from: `"EduSpace" <${process.env.EMAIL}>`,
      to: Email,
      subject: "Verify your Email - EduSpace",
      html: `<h2>Hello ${Name},</h2>
             <p>Your OTP for verification is: <b>${otp}</b></p>
             <p>This OTP is valid for 10 minutes.</p>`
    });

    res.render("verify-otp", { Email });

  } catch (err) {
    console.error(err);
    res.send('<script>alert("Something went wrong, try again");window.location="/register";</script>');
  }
});


// Verify OTP Route
app.post("/verify-otp", async (req, res) => {
  try {
    const { Email, otp } = req.body;
    const record = otpStore[Email];

    if (!record) {
      return res.send('<script>alert("OTP expired or not found");window.location="/register";</script>');
    }

    if (record.otp !== otp || record.expires < Date.now()) {
      return res.render("verify-otp", { Email });  // reload with email
    }

    // ✅ Save verified user to DB
    const newUser = new User({
      Name: record.Name,
      Email: record.Email,
      Password: record.Password,
      verified: true
    });
    await newUser.save();

    // Clear temp OTP
    delete otpStore[Email];

    res.send('<script>alert("Email verified successfully! Please login.");window.location="/login";</script>');
  } catch (err) {
    console.error(err);
    res.send('<script>alert("Verification failed");window.location="/verify-otp";</script>');
  }
});




app.post('/login', async (req, res) => {
  try {
    const { Email, Password } = req.body;
    const user = await User.findOne({ Email });
    if (!user) {
      return res.send(
        '<script>alert("No such user");window.location="/login";</script>'
      );
    }

    const isMatch = await bcrypt.compare(Password, user.Password);
    if (!isMatch) {
      return res.send(
        '<script>alert("Invalid password");window.location="/login";</script>'
      );
    }

    req.session.user = {
      _id: user._id.toString(),
      Name: user.Name,
      Email: user.Email,
    };

    res.redirect('/interface');
  } catch (err) 
  {
    console.error(err);
    res.status(500).send('Server error');
  }
});

app.get('/interface',isAuth,async(req,res)=>{
    try{
    const currentUserId=req.session.user._id;
    const ObjectId= mongoose.Types.ObjectId;
        const chats = await Chat.aggregate([
      {
        $match: {
          $or: [{ sender: new ObjectId(currentUserId) }, { receiver: new ObjectId(currentUserId) }],
        },
      },
      {
        $project: {
          otherUser: {
            $cond: [{ $eq: ['$sender', new ObjectId(currentUserId)] }, '$receiver', '$sender'],
          },
          customName: 1,
        },
      },
      {
        $group: {
          _id: '$otherUser',
          customName: { $first: '$customName' },
        },
      },
      {
        $lookup: {
          from: 'userlogins',
          localField: '_id',
          foreignField: '_id',
          as: 'userInfo',
        },
      },
      { $unwind: '$userInfo' },
      {
        $project: {
          _id: '$userInfo._id',
          name: '$userInfo.Name',
          email: '$userInfo.Email',
          customName: 1,
        },
      },
    ]);
    res.render('interface',{ chats });
}
catch(err){
    console.error(err);
    res.status(500).send('Server error loading conversations');
}
});

app.post('/start-chat',async (req,res)=>{
    try{
        const {Email} =req.body;
        const ou=await User.findOne({Email});
        if(ou){
            res.redirect(`/chat/${ou._id}`);
        }
        else{
            return res.send('<script>alert("User not found");window.location="/interface";</script>');
        }
    }
    catch(err){
    console.error(err);
    res.status(500).send('Server error');   
    }
})

app.get('/chat/:id',isAuth, async (req,res)=>{
    try{
    const currentUserId = req.session.user._id;
    const otherUserId = req.params.id;

    const otherUser = await User.findById(otherUserId);
    if (!otherUser) return res.status(404).send('User not found');

    const messages = await Chat.find({
      $or: [
        { sender: currentUserId, receiver: otherUserId },
        { sender: otherUserId, receiver: currentUserId },
      ],
    }).sort({ timestamp: 1 });

    res.render('chatroom', {
      currentUser: req.session.user,
      chatUser: otherUser,
      messages,
      dayjs,
    });
}
catch(err){
    console.error(err);
    res.status(500).send('Error loading chatroom');
}
})

io.on('connection',(socket)=>{
    socket.on('joinRoom',({userId,otherUserId})=>{
        const roomName=[userId,otherUserId].sort().join('_');
        socket.join(roomName);
    })
    socket.on('chatMessage',async ({senderId,receiverId,message})=>{
        const timestamp=dayjs().utc().toDate();

        const newChat = new Chat ({
            sender: senderId,
            receiver: receiverId,
            message,
            timestamp:timestamp
        })
        await newChat.save();

        const roomName=[senderId,receiverId].sort().join('_');
        io.to(roomName).emit('message',{
            sender:senderId,
            receiver:receiverId,
            message,
            timestamp: newChat.timestamp
        })
    })
    socket.on('disconnect',()=>{
        console.log('User disconnected');
    })
})
const PORT = process.env.PORT || 7777;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

