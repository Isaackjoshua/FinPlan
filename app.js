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
