import OpenAI from 'openai';
import 'dotenv/config';
import fs from 'fs';
import readline from 'readline';
import sharp from 'sharp';

const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPEN_ROUTER,
});

const SYSTEM_PROMPT = `
You are an expert YouTube thumbnail designer specializing in creating high-converting, eye-catching thumbnails that maximize click-through rates. Your goal is to generate compelling thumbnail images that stop viewers from scrolling and entice them to click.

## Core Capabilities
- Create custom thumbnails optimized for YouTube's platform requirements (1280x720 pixels, 16:9 aspect ratio)
- Enhance and transform existing reference images provided by users
- Design thumbnails that work effectively across all devices (desktop, mobile, TV)

## Design Principles
1. **Visual Hierarchy**: Ensure the main subject is immediately clear, even at small sizes
2. **Contrast & Clarity**: Use high contrast colors and bold elements that stand out in YouTube's interface
3. **Text Optimization**: 
   - Keep text minimal (3-5 words maximum)
   - Use large, bold, readable fonts
   - Ensure text is legible on mobile devices
4. **Emotional Triggers**: Incorporate faces with expressive emotions when relevant
5. **Color Psychology**: Use vibrant, contrasting colors that grab attention (consider YouTube's dark/light modes)
6. **Rule of Thirds**: Position key elements strategically for maximum visual impact

## Interaction Protocol
Before generating, gather essential information by asking about:
- Video topic and target audience
- Desired emotional tone (exciting, mysterious, educational, shocking, etc.)
- Specific text to include (if any)
- Brand colors or style preferences
- Competitor thumbnails they admire or want to differentiate from
- Any specific elements that must be included

## Technical Specifications
- Resolution: 1280x720 pixels minimum
- File size: Under 2MB
- Format: JPG, GIF, or PNG
- Safe zones: Keep critical elements away from edges (account for different device crops)

## Style Variations
Be prepared to create thumbnails in various styles:
- Minimalist and clean
- Busy and information-packed
- Gaming/entertainment style
- Educational/professional
- Lifestyle/vlog aesthetic
- News/documentary style

When users provide reference images, analyze what works and enhance by:
- Improving composition and focus
- Amplifying emotional impact
- Optimizing color grading
- Adding complementary graphic elements
- Ensuring YouTube optimization

Always explain your design choices and how they align with YouTube best practices for maximum engagement.
`;

// You are great image generator you create image for youtube video thumbnails as per user requirements. user may give you their own existing images as reference and you need to enhance it further. if you have any question you can ask to user first and then generate image.

// Create readline interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Conversation history
let conversationHistory = [];

async function sendMessage(userMessage, includeImage = false) {
    let messages = [...conversationHistory];

    // Add system prompt if it's the first message
    if (messages.length === 0) {
        messages.push({
            role: "system",
            content: SYSTEM_PROMPT
        });
    }

    // Prepare user message content
    let userContent = [
        {
            "type": "text",
            "text": userMessage
        }
    ];

    // Add image if requested
    if (includeImage) {
        const imageBuffer = fs.readFileSync('t-shirt.jpg');
        const base64Image = imageBuffer.toString('base64');
        const imageUrl = `data:image/jpeg;base64,${base64Image}`;

        userContent.push({
            "type": "image_url",
            "image_url": {
                "url": imageUrl,
                "detail": "high"
            }
        });

        const bgBuffer = fs.readFileSync('bg.jpeg')
        const bg64 = bgBuffer.toString('base64');
        const bgUrl = `data:image/jpeg;base64,${bg64}`;

        userContent.push({
            type: 'text',
            text: 'this is the background which you need to use'
        })

        userContent.push({
            "type": 'image_url',
            "image_url": {
                url: bgUrl,
                detail: "high"
            }
        });

        userContent.push({
            type: 'text',
            text: 'use this as logo'
        })

        const logoBuffer = fs.readFileSync('logo.png')
        const logo64 = logoBuffer.toString('base64');
        const logoUrl = `data:image/png;base64,${logo64}`;

        userContent.push({
            "type": 'image_url',
            "image_url": {
                url: logoUrl,
                detail: "high"
            }
        });

        const iconBuffer = fs.readFileSync('icon.jpeg')
        const icon64 = iconBuffer.toString('base64');
        const iconUrl = `data:image/jpeg;base64,${icon64}`;

        userContent.push({
            type: 'text',
            text: 'keep this icon on bottom right side'
        })

        userContent.push({
            "type": 'image_url',
            "image_url": {
                url: iconUrl,
                detail: "high"
            }
        });

         userContent.push({
            type: 'text',
            text: 'create thumbnail for YouTube video Topic is build your own AI persona'
        })
    }

    // Add user message to conversation
    const userMsg = {
        "role": "user",
        "content": userContent
    };

    messages.push(userMsg);
    conversationHistory.push(userMsg);

    const completion = await openai.chat.completions.create({
        model: "google/gemini-2.5-flash-image-preview:free",
        messages: messages
    });

    const assistantMessage = completion.choices[0].message;

    // Check if images are present in the response
    if (assistantMessage.images && assistantMessage.images.length > 0) {
        console.log('\nAI: ' + assistantMessage.content);

        // Extract the base64 image data
        const imageData = assistantMessage.images[0].image_url.url;

        // Remove the data URL prefix (e.g., "data:image/png;base64,")
        const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');

        // Convert base64 to buffer
        const outputImageBuffer = Buffer.from(base64Data, 'base64');

        // Generate filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `generated-image-${timestamp}.png`;

        // Save the image
        fs.writeFileSync(filename, outputImageBuffer);
        resizeImage(filename, `resized-${filename}`, 1280, 720);
        // const timageBuffer = fs.readFileSync(filename);
        // const base64Image = timageBuffer.toString('base64');
        // const imageUrl = `data:image/jpeg;base64,${base64Image}`;
        // console.log(await uploadBase64ToCloudinary('dtrf5mub1', imageUrl, 'first temp'));
        console.log(`Image saved as: ${filename}`);
    } else {
        // Print AI's text response
        console.log('\nAI: ' + assistantMessage.content);
    }

    // Add assistant response to conversation history
    conversationHistory.push({
        role: "assistant",
        content: assistantMessage.content
    });

    return assistantMessage;
}

async function conversationLoop() {
    console.log('Welcome to the AI Image Generator! Type "exit" to quit.');
    console.log('Starting with initial request...\n');

    // First message with image
    await sendMessage("This is the Major image.", true);

    // Continue conversation
    while (true) {
        const userInput = await new Promise((resolve) => {
            rl.question('\nYou: ', resolve);
        });

        if (userInput.toLowerCase() === 'exit') {
            console.log('Goodbye!');
            rl.close();
            break;
        }

        await sendMessage(userInput, false);
    }
}

async function main() {
    await conversationLoop();
}


// base64String: your image data, e.g. "data:image/png;base64,...."
// cloudName: your Cloudinary cloud name
// unsignedUploadPreset: the upload preset you configured

async function uploadBase64ToCloudinary(base64String, cloudName = 'dtrf5mub1', unsignedUploadPreset) {
    const url = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
    const formData = new FormData();
    formData.append('file', base64String);
    formData.append('upload_preset', unsignedUploadPreset);

    const response = await fetch(url, {
        method: 'POST',
        body: formData
    });
    if (!response.ok) {
        const errorText = await response.text();
        console.log('Upload error status:', response.status);
        console.log('Upload error response:', errorText);
        throw new Error(`Upload failed: ${response.status} - ${errorText}`);
    }
    const data = await response.json();
    // The public URL is in data.secure_url
    return data.secure_url;
}
// const imageBuffer = fs.readFileSync('t-shirt.jpg');
// const base64Image = imageBuffer.toString('base64');
// const imageUrl = `data:image/jpeg;base64,${base64Image}`;
// Example usage:
// uploadBase64ToCloudinary(imageUrl, "dtrf5mub1", "first temp")
//     .then(url => console.log('Public URL:', url))
//     .catch(err => console.error(err));


main();

// resizeImage('t-shirt.jpg', 'resized-t-shirt.jpg', 1280, 720);

async function resizeImage(inputPath, outputPath, width, height) {
    try {
        await sharp(inputPath)
            .resize(width, height, {
                fit: "fill", // can use "inside" to preserve aspect ratio
                kernel: sharp.kernel.lanczos3, // high-quality resampling
            })
            .png({ compressionLevel: 0 }) // lossless PNG
            .toFile(outputPath);

        console.log(`✅ Resized image saved to ${outputPath}`);
    } catch (err) {
        console.error("❌ Error resizing image:", err);
    }
}