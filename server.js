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
dayjs.extend(utc);
dayjs.extend(timezone);

const User=require('./models/User')
const store=new Mongodbstore({
    uri:process.env.M,
    collection:'session'
})
store.on('error',function(error){
    console.log('Session store error',error);
})

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

mongoose.connect(process.env.M)
.then(
    console.log('Database connected successfully')
)
.catch(err=>{
    console.log('Database connection failed', err);
})

app.post('/register', async (req, res) => {
  try {
    const { Name, Email, Password, ConfirmPassword } = req.body;

    if (Password !== ConfirmPassword) {
      return res.send(
        '<script>alert("Passwords do not match");window.location="/register";</script>'
      );
    }

    const existingUser = await User.findOne({ Email });
    if (existingUser) {
      return res.send(
        '<script>alert("Email already registered");window.location="/register";</script>'
      );
    }

    const hashedPassword = await bcrypt.hash(Password, 10);

    const newUser = new User({
      Name,
      Email,
      Password: hashedPassword,
    });
    await newUser.save();
    res.render('login');
}
catch(err){
    console.error('Error during registration:', err);
    res.status(500).send(
      '<script>alert("An error occurred during registration");window.location="/register";</script>'
    );
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
server.listen(7777,()=>{
    console.log('Server is running on port 7777');
})
