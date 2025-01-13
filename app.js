console.log("Welcome to Financial Literacy App!");
function showComingSoon() {
    alert("This feature is under development. Stay tuned!");
}
// Select all collapsible buttons
const collapsibleButtons = document.querySelectorAll('.collapsible-btn');

// Add event listeners to toggle content visibility
collapsibleButtons.forEach((button) => {
    button.addEventListener('click', () => {
        // Toggle active state
        const content = button.nextElementSibling;
        const isVisible = content.style.display === 'block';
        
        // Hide all collapsible contents
        document.querySelectorAll('.collapsible-content').forEach((el) => {
            el.style.display = 'none';
        });

        // Toggle the selected one
        content.style.display = isVisible ? 'none' : 'block';
    });
});

// Select the form
const mentorForm = document.getElementById('mentor-form');

// Add an event listener for form submission
mentorForm.addEventListener('submit', (event) => {
    event.preventDefault(); // Prevent the form from reloading the page

    // Get form values
    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const interest = document.getElementById('interest').value;

    // Create a mentorship request object
    const mentorshipRequest = {
        name,
        email,
        interest,
        date: new Date().toLocaleString(), // Add a timestamp
    };

    // Retrieve existing requests from local storage
    const existingRequests = JSON.parse(localStorage.getItem('mentorshipRequests')) || [];

    // Add the new request to the array
    existingRequests.push(mentorshipRequest);

    // Save the updated array back to local storage
    localStorage.setItem('mentorshipRequests', JSON.stringify(existingRequests));

    // Display a confirmation message
    alert(`Thank you, ${name}! Your mentorship request for ${interest} has been received. We'll contact you at ${email}.`);

    // Clear the form
    mentorForm.reset();
});
// Display mentorship requests
const displayRequests = () => {
    const requestsList = document.getElementById('requests-list');
    const requests = JSON.parse(localStorage.getItem('mentorshipRequests')) || [];

    // Clear the current list
    requestsList.innerHTML = '';

    // Add each request to the list
    requests.forEach((request, index) => {
        const listItem = document.createElement('li');
        listItem.textContent = `${index + 1}. ${request.name} (${request.email}) - Interested in ${request.interest} [${request.date}]`;
        requestsList.appendChild(listItem);
    });
};

// Call the function to display requests
displayRequests();
// Handle "Notify Me" button click
const notifyMeButton = document.getElementById('notify-me');

notifyMeButton.addEventListener('click', () => {
    alert('Thank you! We’ll notify you when the Micro-Investments feature is live.');
});
// Content for financial literacy topics
const literacyContent = {
    budgeting: `
        <h3>Budgeting</h3>
        <p>Budgeting is the foundation of financial success. Here are some tips:</p>
        <ul>
            <li>Track your expenses regularly.</li>
            <li>Set realistic spending limits.</li>
            <li>Follow the 50/30/20 rule: 50% for needs, 30% for wants, 20% for savings.</li>
        </ul>
    `,
    investing: `
        <h3>Investing Basics</h3>
        <p>Investing helps you grow your wealth over time. Key points to remember:</p>
        <ul>
            <li>Understand the risks and rewards of different investments.</li>
            <li>Diversify your portfolio to minimize risk.</li>
            <li>Start small and increase your investments as you learn.</li>
        </ul>
    `,
    saving: `
        <h3>Saving Strategies</h3>
        <p>Saving money is crucial for financial stability. Here's how to start:</p>
        <ul>
            <li>Set specific savings goals (e.g., emergency fund, travel, etc.).</li>
            <li>Automate your savings to make it a habit.</li>
            <li>Cut unnecessary expenses and redirect them to savings.</li>
        </ul>
    `,
    debt: `
        <h3>Managing Debt</h3>
        <p>Debt can be overwhelming, but it can be managed effectively:</p>
        <ul>
            <li>Pay off high-interest debts first (debt avalanche method).</li>
            <li>Consider the snowball method for quick wins: pay small debts first.</li>
            <li>Avoid taking on new debt unless absolutely necessary.</li>
        </ul>
    `,
};

// Handle topic button clicks
const literacyTopics = document.getElementById('literacy-topics');
const literacyContentDiv = document.getElementById('literacy-content');

literacyTopics.addEventListener('click', (event) => {
    if (event.target.classList.contains('topic-btn')) {
        const topic = event.target.getAttribute('data-topic');
        literacyContentDiv.innerHTML = literacyContent[topic] || '<p>Content not available.</p>';
    }
});
