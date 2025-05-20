// app/api/lti/launch/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';

// Mock database of secure tokens
// In a real application, this would be stored in a database
const secureTokens = new Map<string, { assignmentId: number, expiresAt: Date }>();

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // This is a redirect handler for viewing assignment info
  // We'll redirect to the proper assignment page
  return NextResponse.redirect(new URL(`/assignments/${params.id}`, request.url));
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const assignmentId = parseInt(params.id);
  
  // Parse the request body to get the token if present
  const formData = await request.formData();
  const token = formData.get('token') as string || request.nextUrl.searchParams.get('token');
  
  try {
    // Get the assignment from the database
    const assignment = await getAssignment(assignmentId);
    
    if (!assignment) {
      return new NextResponse(
        JSON.stringify({ error: 'Assignment not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Check if the assignment is public or if the token is valid
    if (!assignment.published) {
      // If the assignment is private, verify the token
      if (!token || !isValidToken(token, assignmentId)) {
        return new NextResponse(
          JSON.stringify({ error: 'Invalid or missing token for a private assignment' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
    
    // Generate the LTI launch parameters
    const ltiParams = generateLtiParams(assignmentId, formData);
    
    // Create a response with the LTI form that will auto-submit
    return new NextResponse(renderLtiLaunchForm(ltiParams), {
      headers: { 'Content-Type': 'text/html' }
    });
  } catch (error) {
    console.error('Error processing LTI launch:', error);
    
    return new NextResponse(
      JSON.stringify({ error: 'Failed to process LTI launch' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// Function to get assignment details
async function getAssignment(assignmentId: number) {
  // In a real application, this would be a database query
  // For now, we'll just return mock data
  
  // Mock assignments data
  const assignments = [
    { id: 1, name: 'Introduction to Data Structures', published: true },
    { id: 2, name: 'Python Programming Fundamentals', published: true },
    { id: 3, name: 'Machine Learning Basics', published: false },
    { id: 4, name: 'Web Development with React', published: true },
    { id: 5, name: 'Database Design Principles', published: false },
  ];
  
  return assignments.find(a => a.id === assignmentId);
}

// Function to validate secure tokens
function isValidToken(token: string, assignmentId: number): boolean {
  const tokenData = secureTokens.get(token);
  
  if (!tokenData) {
    return false;
  }
  
  // Check if the token is for the correct assignment and hasn't expired
  return (
    tokenData.assignmentId === assignmentId && 
    tokenData.expiresAt > new Date()
  );
}

// Function to generate LTI parameters
function generateLtiParams(assignmentId: number, formData: FormData): Record<string, string> {
  // LTI 1.0 required parameters
  const ltiParams: Record<string, string> = {
    lti_message_type: 'basic-lti-launch-request',
    lti_version: 'LTI-1p0',
    resource_link_id: assignmentId.toString(),
    roles: formData.get('roles')?.toString() || 'Learner',
    launch_presentation_return_url: formData.get('launch_presentation_return_url')?.toString() || '',
    
    // Additional parameters for the assignment
    custom_assignment_id: assignmentId.toString(),
    custom_launch_type: 'assignment',
    
    // Mock user information - in a real implementation, this would be from the authenticated user
    user_id: formData.get('user_id')?.toString() || 'anonymous_user',
    lis_person_name_full: formData.get('lis_person_name_full')?.toString() || 'Anonymous User',
    lis_person_contact_email_primary: formData.get('lis_person_contact_email_primary')?.toString() || '',
  };
  
  // Add consumer key and secret - in a real implementation, these would be from a configuration
  const consumerKey = process.env.LTI_CONSUMER_KEY || 'default_consumer_key';
  const consumerSecret = process.env.LTI_CONSUMER_SECRET || 'default_consumer_secret';
  
  // Generate OAuth signature
  const oauthSignature = generateOAuthSignature(
    consumerKey,
    consumerSecret,
    ltiParams,
    process.env.MARK_SERVICE_LTI_LAUNCH_URL || 'https://mark.example.com/lti/launch'
  );
  
  return { ...ltiParams, ...oauthSignature };
}

// Function to generate OAuth signature
function generateOAuthSignature(
  consumerKey: string,
  consumerSecret: string,
  params: Record<string, string>,
  launchUrl: string
): Record<string, string> {
  // In a real implementation, this would use a proper OAuth library
  // This is a simplified mock implementation
  
  // Generate a timestamp and nonce
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = Math.random().toString(36).substring(2, 15);
  
  // Add OAuth parameters
  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_nonce: nonce,
    oauth_version: '1.0',
  };
  
  // In a real implementation, we would calculate the signature properly
  // For now, we'll just return the OAuth parameters
  return oauthParams;
}

// Function to render the auto-submitting form
function renderLtiLaunchForm(ltiParams: Record<string, string>): string {
  const launchUrl = process.env.MARK_SERVICE_LTI_LAUNCH_URL || 'https://mark.example.com/lti/launch';
  
  // Create hidden inputs for all LTI parameters
  const hiddenInputs = Object.entries(ltiParams)
    .map(([key, value]) => `<input type="hidden" name="${key}" value="${value}" />`)
    .join('\n      ');
  
  // Create the HTML form
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Launching Assignment...</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      background-color: #f5f5f5;
    }
    .container {
      text-align: center;
      background-color: white;
      padding: 2rem;
      border-radius: 0.5rem;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
    h1 {
      color: #4f46e5;
      margin-bottom: 1rem;
    }
    p {
      color: #6b7280;
      margin-bottom: 2rem;
    }
    .spinner {
      border: 4px solid rgba(0, 0, 0, 0.1);
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border-left-color: #4f46e5;
      animation: spin 1s linear infinite;
      margin: 0 auto 2rem;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .btn {
      background-color: #4f46e5;
      color: white;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 0.25rem;
      cursor: pointer;
      font-size: 1rem;
    }
    .btn:hover {
      background-color: #4338ca;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Launching Assignment</h1>
    <div class="spinner"></div>
    <p>Please wait while we redirect you to the assignment...</p>
    
    <form id="lti-launch-form" action="${launchUrl}" method="post" encType="application/x-www-form-urlencoded">
      ${hiddenInputs}
      <button type="submit" class="btn">Launch Manually</button>
    </form>
    
    <script>
      // Auto-submit the form
      document.addEventListener('DOMContentLoaded', function() {
        setTimeout(function() {
          document.getElementById('lti-launch-form').submit();
        }, 1000);
      });
    </script>
  </div>
</body>
</html>
  `;
}

// API endpoint to generate a secure token for private assignments
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const assignmentId = parseInt(params.id);
  
  try {
    // Get the assignment from the database
    const assignment = await getAssignment(assignmentId);
    
    if (!assignment) {
      return new NextResponse(
        JSON.stringify({ error: 'Assignment not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Generate a new token
    const token = Math.random().toString(36).substring(2, 15) + 
                  Math.random().toString(36).substring(2, 15);
    
    // Set the token expiration (e.g., 30 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    
    // Store the token
    secureTokens.set(token, { assignmentId, expiresAt });
    
    // Return the token
    return new NextResponse(
      JSON.stringify({ 
        token, 
        shareUrl: `/assignments/launch/${assignmentId}?token=${token}`,
        expiresAt 
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error generating token:', error);
    
    return new NextResponse(
      JSON.stringify({ error: 'Failed to generate token' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}