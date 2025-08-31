# YouTube Thumbnail Creator 🎨

A powerful, AI-driven platform for creating customized YouTube thumbnails with intelligent optimization and query rewriting capabilities.

## 🚀 Live Demo

**Hosted URL:** [https://www.thumbnail.sprintup.in/](Link)

## 📋 Overview

This application leverages the MERN stack combined with cutting-edge Agentic AI to automatically generate and optimize YouTube thumbnails. The platform uses advanced query rewriting and optimization techniques to create more efficient and engaging thumbnails that are tailored to maximize click-through rates and viewer engagement.

## ✨ Features

- **🤖 AI-Powered Thumbnail Generation**: Utilizes Agentic AI to create compelling thumbnails
- **🔄 Query Rewriter**: Intelligent query processing and optimization for better results
- **⚡ Performance Optimization**: Enhanced thumbnail generation efficiency through smart algorithms
- **🎯 Customizable Templates**: Wide variety of thumbnail styles and layouts
- **📊 Analytics Integration**: Track thumbnail performance and engagement metrics
- **🖼️ Real-time Preview**: See your thumbnails as you create them
- **📱 Responsive Design**: Works seamlessly across all devices
- **☁️ AWS S3 Integration**: Reliable cloud storage and fast image delivery
- **🚀 Direct API Access**: No authentication required - start generating immediately

## 🛠️ Tech Stack

### Frontend
- **React.js** - Dynamic user interface
- **HTML5/CSS3** - Structure and styling
- **JavaScript (ES6+)** - Core functionality

### Backend
- **Node.js** - Runtime environment
- **Express.js** - Web application framework

### AI & Optimization
- **Agentic AI** - Intelligent thumbnail generation
- **Query Rewriter** - Advanced query processing and optimization
- **Machine Learning Models** - Thumbnail performance optimization

### Additional Tools
- **Multer** - File upload handling
- **AWS S3** - Image storage and delivery

## 🚀 Getting Started

### Prerequisites

- Node.js (v20 or higher)
- npm or yarn package manager
- AWS S3 account for image storage

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/drumil32/Youtube-Thumbnail-Generator-backend
   cd youtube-thumbnail-creator
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

4. **Set up environment variables**
   
   Create a `.env` file in the backend directory:
   ```env
   OPEN_ROUTER=
   GEMINI_API_KEY=
   OPENAI_API_KEY
   AWS_ACCESS_KEY_ID=your_aws_access_key
   AWS_SECRET_ACCESS_KEY=your_aws_secret_key
   AWS_REGION=your_aws_region
   AWS_S3_BUCKET_NAME=your_s3_bucket_name
   PORT=5000
   ```

5. **Start the development servers**
   
   Backend:
   ```bash
   node index.js
   ```

## 📚 Usage

1. **Send your content details** (title, description, target audience) via API
2. **Specify thumbnail preferences** and style requirements
3. **AI generates optimized thumbnails** using query rewriter technology
4. **Receive thumbnail URLs** from AWS S3 storage
5. **Download or integrate** thumbnails into your workflow

## 🤝 Contributing

We welcome contributions to improve the YouTube Thumbnail Creator! Here's how you can help:

1. **Fork the repository**
2. **Create a feature branch** (`git checkout -b feature/AmazingFeature`)
3. **Commit your changes** (`git commit -m 'Add some AmazingFeature'`)
4. **Push to the branch** (`git push origin feature/AmazingFeature`)
5. **Open a Pull Request**

## 🎯 Future Enhancements

- [ ] Integration with YouTube API for direct upload
- [ ] A/B testing functionality for thumbnail variants
- [ ] Advanced analytics dashboard
- [ ] Mobile app development
- [ ] Bulk thumbnail generation
- [ ] Custom AI model training

## 🙏 Acknowledgments

- Thanks to the open-source community for the amazing tools and libraries
- Special thanks to the AI research community for advancing thumbnail optimization
- Inspired by content creators who need better thumbnail tools

---

**Made with ❤️ by Drumil Akhenia**

*Star ⭐ this repo if you find it helpful!*